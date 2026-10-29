-- 019: TLC records match is required before accepting rides; per-driver owner-only override (reason, optional expiry, revocable, audited).
create table if not exists public.taxi_tlc_overrides (user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check (length(trim(reason)) >= 10), set_by uuid not null, set_at timestamptz not null default now(), expires_at timestamptz,
  revoked_at timestamptz, revoked_by uuid, revoke_reason text);
alter table public.taxi_tlc_overrides enable row level security;
drop policy if exists "dispatch reads overrides" on public.taxi_tlc_overrides;
create policy "dispatch reads overrides" on public.taxi_tlc_overrides for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner'));
-- no insert/update/delete policies: writes only through the owner-only RPCs below
create table if not exists public.taxi_tlc_override_log (id bigserial primary key, driver uuid not null, action text not null check (action in ('set','revoke')),
  actor uuid not null, reason text not null, expires_at timestamptz, at timestamptz not null default now());
alter table public.taxi_tlc_override_log enable row level security;
drop policy if exists "dispatch reads override log" on public.taxi_tlc_override_log;
create policy "dispatch reads override log" on public.taxi_tlc_override_log for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner'));
drop trigger if exists t_override_log_append_only on public.taxi_tlc_override_log;
create trigger t_override_log_append_only before update or delete on public.taxi_tlc_override_log for each row execute function public.append_only();

create or replace function public.tlc_override_active(p_user uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.taxi_tlc_overrides o where o.user_id = p_user and o.revoked_at is null and (o.expires_at is null or o.expires_at > now())) $$;
revoke all on function public.tlc_override_active(uuid) from public, anon;

create or replace function public.set_tlc_override(p_driver uuid, p_reason text, p_expires timestamptz default null) returns void language plpgsql security definer set search_path to '' as $$
begin
  if (select public.taxi_role()) is distinct from 'owner' then raise exception 'owner only'; end if;
  if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'write a reason (10+ characters)'; end if;
  if p_expires is not null and p_expires <= now() then raise exception 'expiry must be in the future'; end if;
  if not exists (select 1 from public.taxi_driver_docs where user_id = p_driver) then raise exception 'driver has no documents on file'; end if;
  insert into public.taxi_tlc_overrides as o (user_id, reason, set_by, set_at, expires_at) values (p_driver, left(trim(p_reason),300), auth.uid(), now(), p_expires)
  on conflict (user_id) do update set reason = excluded.reason, set_by = excluded.set_by, set_at = now(), expires_at = excluded.expires_at, revoked_at = null, revoked_by = null, revoke_reason = null;
  insert into public.taxi_tlc_override_log (driver, action, actor, reason, expires_at) values (p_driver, 'set', auth.uid(), left(trim(p_reason),300), p_expires);
end $$;
create or replace function public.revoke_tlc_override(p_driver uuid, p_reason text) returns void language plpgsql security definer set search_path to '' as $$
begin
  if (select public.taxi_role()) is distinct from 'owner' then raise exception 'owner only'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'write a reason'; end if;
  update public.taxi_tlc_overrides set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(trim(p_reason),300) where user_id = p_driver and revoked_at is null;
  if not found then raise exception 'no active override'; end if;
  insert into public.taxi_tlc_override_log (driver, action, actor, reason) values (p_driver, 'revoke', auth.uid(), left(trim(p_reason),300));
end $$;
-- Dispatch list: every driver's TLC-match + override status (badge), staff only.
create or replace function public.tlc_driver_status() returns table(user_id uuid, name text, tlc_driver_license text, tlc_vehicle_license text, plate text, tlc_match boolean, tlc_checked_at timestamptz,
  override_active boolean, override_reason text, override_set_at timestamptz, override_expires_at timestamptz, override_by text, is_owner boolean)
language sql stable security definer set search_path to '' as $$
  select d.user_id, p.display_name, d.tlc_driver_license, d.tlc_vehicle_license, d.plate,
    coalesce((d.tlc_check->>'driver_active')::boolean and (d.tlc_check->>'vehicle_active')::boolean, false), d.tlc_checked_at,
    public.tlc_override_active(d.user_id), o.reason, o.set_at, o.expires_at, ob.display_name, (select public.taxi_role()) = 'owner'
  from public.taxi_driver_docs d left join public.profiles p on p.id = d.user_id left join public.taxi_tlc_overrides o on o.user_id = d.user_id left join public.profiles ob on ob.id = o.set_by
  where (select public.taxi_role()) in ('dispatcher','owner') order by p.display_name $$;
revoke all on function public.set_tlc_override(uuid,text,timestamptz), public.revoke_tlc_override(uuid,text), public.tlc_driver_status() from public, anon;
grant execute on function public.set_tlc_override(uuid,text,timestamptz), public.revoke_tlc_override(uuid,text), public.tlc_driver_status() to authenticated;

create or replace function public.ride_event(p_ext text, p_type text, p_data jsonb default '{}') returns void
language plpgsql security definer set search_path to '' as $$
declare r text := (select public.taxi_role()); d public.taxi_driver_docs; b public.taxi_bookings; n text; x public.rides; probs text[]; f numeric;
  disp constant text := 'B00639'; qa boolean := exists (select 1 from public.taxi_test_accounts t where t.user_id = auth.uid());
begin
  if r not in ('driver','dispatcher','owner') then raise exception 'staff only'; end if;
  if p_type not in ('accept','arrived','start','complete','cancel_driver','paid','assign','pin_ok') then raise exception 'bad event'; end if;
  select * into d from public.taxi_driver_docs where user_id = auth.uid(); select * into b from public.taxi_bookings where ext_id = p_ext; select display_name into n from public.profiles where id = auth.uid();
  if p_type = 'accept' then
    -- 59B-19(a)(1)(ii)-(v) + 77-20(c)(2): no dispatch without valid driver, vehicle and base license numbers
    probs := public.tlc_license_problems(d.tlc_driver_license, d.tlc_vehicle_license, d.plate, disp, d.affiliated_base);
    if d.user_id is null or d.review_status is distinct from 'approved' then probs := array_append(probs, 'driver documents not approved by dispatch'::text); end if;
    if d.tlc_exp is null or d.tlc_exp < current_date then probs := array_append(probs, 'TLC driver license expired'::text); end if;
    -- Fan (2026-10-28): every driver must PASS the NYC TLC records match, unless the owner set an active override.
    -- The override skips only this match; license format, approval and expiry checks above/below still apply.
    if not (coalesce((d.tlc_check->>'driver_active')::boolean, false) and coalesce((d.tlc_check->>'vehicle_active')::boolean, false))
       and not public.tlc_override_active(auth.uid()) then probs := array_append(probs, 'not verified active in NYC TLC records (run Check TLC records, or owner override)'::text); end if;
    if b.wav_requested and not coalesce(d.wav,false) then probs := array_append(probs, 'rider requested a wheelchair-accessible vehicle'::text); end if;
    if qa then probs := '{}'; end if; -- QA test accounts (015): fake TEST numbers, trip kept out of TLC files (dispatching_base null)
    if coalesce(array_length(probs,1),0) > 0 then raise exception 'cannot dispatch: %', array_to_string(probs, '; '); end if;
    if b.id is null then raise exception 'no server booking for this trip'; end if;
    select * into x from public.rides where ext_id = p_ext;
    if x.started_at is not null then raise exception 'trip already started'; end if;
    insert into public.rides (ext_id, booking_id, driver, driver_name, tlc_driver_license, tlc_vehicle_license, plate, base_number, dispatching_base, affiliated_base, vehicle_class, wav, wav_requested, shared_request,
      pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, flat_rate, request_at, quote_total, rate_version, fare, status, accepted_at)
    values (left(p_ext,64), b.id, auth.uid(), n, d.tlc_driver_license, d.tlc_vehicle_license, upper(d.plate), disp, case when qa then null else disp end, d.affiliated_base, b.vehicle_class, coalesce(d.wav,false), b.wav_requested, b.shared_request,
      b.pickup_address, b.pickup_lat, b.pickup_lng, b.dropoff_address, b.dropoff_lat, b.dropoff_lng, b.flat_rate, coalesce(b.scheduled_for, b.created_at), b.quote_total, b.rate_version, b.quote_total, 'accepted', now())
    on conflict (ext_id) do update set driver = excluded.driver, driver_name = excluded.driver_name, tlc_driver_license = excluded.tlc_driver_license, tlc_vehicle_license = excluded.tlc_vehicle_license,
      plate = excluded.plate, affiliated_base = excluded.affiliated_base, wav = excluded.wav, status = 'accepted', accepted_at = now(), cancelled_at = null, cancelled_by = null;
    update public.taxi_bookings set status = 'en_route', assigned_driver = auth.uid(), assigned_driver_name = n where id = b.id;
  elsif p_type <> 'assign' then
    select * into x from public.rides where ext_id = p_ext and (driver = auth.uid() or r in ('dispatcher','owner'));
    if x.ext_id is null then raise exception 'not your ride'; end if;
    if p_type = 'start' and x.arrived_at is null then update public.rides set arrived_at = now() where ext_id = p_ext; end if;
    if p_type = 'complete' then
      if x.started_at is null then raise exception 'trip was never started (no pickup time)'; end if;
      f := coalesce((p_data->>'fare')::numeric, x.quote_total);
      -- 59B-23(a)/(b)(3): never charge more than the binding quote from the filed schedule
      if x.quote_total is not null and f > x.quote_total then raise exception 'fare % is above the binding quote %', f, x.quote_total; end if;
    end if;
    update public.rides set status = case p_type when 'arrived' then 'arrived' when 'start' then 'in_progress' when 'complete' then 'completed' when 'cancel_driver' then 'cancelled_driver' else status end,
      arrived_at = case when p_type = 'arrived' then coalesce(arrived_at, now()) else arrived_at end, started_at = case when p_type = 'start' then coalesce(started_at, now()) else started_at end,
      completed_at = case when p_type = 'complete' then now() else completed_at end, cancelled_at = case when p_type = 'cancel_driver' then now() else cancelled_at end,
      cancelled_by = case when p_type = 'cancel_driver' then 'driver' else cancelled_by end,
      fare = case when p_type = 'complete' then f else fare end,
      paid_at = case when p_type = 'paid' then now() else paid_at end, paid_method = case when p_type = 'paid' then left(p_data->>'method',10) else paid_method end
    where ext_id = p_ext;
    update public.taxi_bookings set status = case p_type when 'arrived' then 'arrived' when 'start' then 'in_progress' when 'complete' then 'completed' when 'cancel_driver' then 'cancelled_driver' else status end where id = b.id;
  end if;
  insert into public.ride_events (ext_id, type, actor, actor_role, data) values (left(p_ext,64), p_type, auth.uid(), r, p_data - 'pin');
end $$;

