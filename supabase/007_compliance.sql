-- 007: driver documents (license numbers, expiries, WAV, verified payment handle), ride records + events with 6-month retention, complaints.
create table if not exists public.taxi_driver_docs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tlc_driver_license text, tlc_vehicle_license text, plate text, wav boolean not null default false,
  dmv_exp date, tlc_exp date, reg_exp date, ins_exp date,
  pay_kind text check (pay_kind in ('zelle','venmo')), pay_handle text, handle_verified boolean not null default false,
  review_status text not null default 'pending' check (review_status in ('pending','approved','needs_doc','declined')), review_note text,
  reviewed_by uuid, reviewed_at timestamptz, updated_at timestamptz not null default now());
alter table public.taxi_driver_docs enable row level security;
create policy "driver reads own docs" on public.taxi_driver_docs for select to authenticated using (user_id = (select auth.uid()) or (select public.taxi_role()) in ('dispatcher','owner'));

create or replace function public.save_driver_docs(p jsonb) returns public.taxi_driver_docs
language plpgsql security definer set search_path to '' as $$
declare r public.taxi_driver_docs; old public.taxi_driver_docs;
begin
  if (select public.taxi_role()) not in ('driver','dispatcher','owner') then raise exception 'staff only'; end if;
  select * into old from public.taxi_driver_docs where user_id = auth.uid();
  insert into public.taxi_driver_docs as d (user_id, tlc_driver_license, tlc_vehicle_license, plate, wav, dmv_exp, tlc_exp, reg_exp, ins_exp, pay_kind, pay_handle, handle_verified, review_status, updated_at)
  values (auth.uid(), left(nullif(trim(p->>'tlc_driver_license'),''),20), left(nullif(trim(p->>'tlc_vehicle_license'),''),20), left(upper(nullif(trim(p->>'plate'),'')),12), coalesce((p->>'wav')::boolean,false),
    nullif(p->>'dmv_exp','')::date, nullif(p->>'tlc_exp','')::date, nullif(p->>'reg_exp','')::date, nullif(p->>'ins_exp','')::date,
    case when lower(p->>'pay_kind') in ('zelle','venmo') then lower(p->>'pay_kind') end, left(nullif(trim(p->>'pay_handle'),''),60), false, 'pending', now())
  on conflict (user_id) do update set tlc_driver_license = excluded.tlc_driver_license, tlc_vehicle_license = excluded.tlc_vehicle_license, plate = excluded.plate, wav = excluded.wav,
    dmv_exp = excluded.dmv_exp, tlc_exp = excluded.tlc_exp, reg_exp = excluded.reg_exp, ins_exp = excluded.ins_exp, pay_kind = excluded.pay_kind, pay_handle = excluded.pay_handle,
    -- any change to a document or handle sends it back for dispatch review
    handle_verified = d.handle_verified and d.pay_handle is not distinct from excluded.pay_handle and d.pay_kind is not distinct from excluded.pay_kind,
    review_status = case when (d.tlc_driver_license, d.tlc_vehicle_license, d.plate, d.wav, d.dmv_exp, d.tlc_exp, d.reg_exp, d.ins_exp) is not distinct from
      (excluded.tlc_driver_license, excluded.tlc_vehicle_license, excluded.plate, excluded.wav, excluded.dmv_exp, excluded.tlc_exp, excluded.reg_exp, excluded.ins_exp) then d.review_status else 'pending' end,
    updated_at = now()
  returning * into r; return r;
end $$;

-- Go-online gate, evaluated on the server clock: every document present and unexpired.
create or replace function public.driver_ready() returns table(ok boolean, problems text[])
language plpgsql stable security definer set search_path to '' as $$
declare d public.taxi_driver_docs; p text[] := '{}';
begin
  if (select public.taxi_role()) not in ('driver','dispatcher','owner') then return query select false, array['not a driver']; return; end if;
  select * into d from public.taxi_driver_docs where user_id = auth.uid();
  if d.user_id is null then return query select false, array['documents not on file']; return; end if;
  if d.tlc_driver_license is null then p := p || 'TLC driver license number missing'; end if;
  if d.tlc_vehicle_license is null then p := p || 'TLC vehicle (FHV) license number missing'; end if;
  if d.dmv_exp is null or d.dmv_exp < current_date then p := p || 'DMV driver license expired or missing'; end if;
  if d.tlc_exp is null or d.tlc_exp < current_date then p := p || 'TLC driver license expired or missing'; end if;
  if d.reg_exp is null or d.reg_exp < current_date then p := p || 'vehicle registration expired or missing'; end if;
  if d.ins_exp is null or d.ins_exp < current_date then p := p || 'insurance expired or missing'; end if;
  if d.review_status = 'declined' then p := p || 'application declined by dispatch'; end if;
  return query select coalesce(array_length(p,1),0) = 0, p;
end $$;

create or replace function public.review_driver(p_user uuid, p_status text, p_note text, p_handle_ok boolean) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if (select public.taxi_role()) not in ('dispatcher','owner') then raise exception 'dispatch only'; end if;
  if p_status not in ('pending','approved','needs_doc','declined') then raise exception 'bad status'; end if;
  update public.taxi_driver_docs set review_status = p_status, review_note = left(p_note,300), handle_verified = coalesce(p_handle_ok, handle_verified) and pay_handle is not null,
    reviewed_by = auth.uid(), reviewed_at = now() where user_id = p_user;
end $$;

-- Public driver card for riders (TLC license numbers are public record); payment handle only once dispatch verified it.
create or replace function public.driver_card(p_kid uuid) returns table(name text, tlc_driver_license text, tlc_vehicle_license text, plate text, wav boolean, pay_kind text, pay_handle text, approved boolean)
language sql stable security definer set search_path to '' as $$
  select coalesce(p.display_name, k.name), d.tlc_driver_license, d.tlc_vehicle_license, d.plate, coalesce(d.wav,false),
    case when d.handle_verified then d.pay_kind end, case when d.handle_verified then d.pay_handle end, d.review_status = 'approved'
  from public.taxi_staff_keys k join public.profiles p on p.id = k.user_id left join public.taxi_driver_docs d on d.user_id = k.user_id
  where k.kid = p_kid and not k.revoked and p.taxi_role in ('driver','dispatcher','owner') $$;

create table if not exists public.rides (
  ext_id text primary key, booking_id uuid references public.taxi_bookings(id) on delete set null,
  driver uuid, driver_name text, tlc_driver_license text, tlc_vehicle_license text, plate text, base_number text,
  vehicle_class text, wav boolean, fare numeric, status text not null default 'accepted',
  accepted_at timestamptz, arrived_at timestamptz, started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz, paid_at timestamptz, paid_method text,
  created_at timestamptz not null default now());
create table if not exists public.ride_events (id bigserial primary key, ext_id text not null, type text not null, actor uuid, actor_role text, data jsonb, at timestamptz not null default now());
create index if not exists ride_events_ext on public.ride_events(ext_id);
create index if not exists ride_events_at on public.ride_events(at);
alter table public.rides enable row level security; alter table public.ride_events enable row level security;
create policy "staff read rides" on public.rides for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner') or driver = (select auth.uid()));
create policy "staff read ride events" on public.ride_events for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner') or actor = (select auth.uid()));

create or replace function public.ride_event(p_ext text, p_type text, p_data jsonb default '{}') returns void
language plpgsql security definer set search_path to '' as $$
declare r text := (select public.taxi_role()); d public.taxi_driver_docs; b public.taxi_bookings; n text;
begin
  if r not in ('driver','dispatcher','owner') then raise exception 'staff only'; end if;
  if p_type not in ('accept','arrived','start','complete','cancel_driver','paid','assign','pin_ok') then raise exception 'bad event'; end if;
  select * into d from public.taxi_driver_docs where user_id = auth.uid(); select * into b from public.taxi_bookings where ext_id = p_ext; select display_name into n from public.profiles where id = auth.uid();
  if p_type = 'accept' then
    insert into public.rides (ext_id, booking_id, driver, driver_name, tlc_driver_license, tlc_vehicle_license, plate, base_number, vehicle_class, wav, fare, status, accepted_at)
    values (left(p_ext,64), b.id, auth.uid(), n, d.tlc_driver_license, d.tlc_vehicle_license, d.plate, left(p_data->>'base',20), b.vehicle_class, coalesce(d.wav,false), coalesce((p_data->>'fare')::numeric, b.fare_estimate), 'accepted', now())
    on conflict (ext_id) do update set driver = excluded.driver, driver_name = excluded.driver_name, tlc_driver_license = excluded.tlc_driver_license, tlc_vehicle_license = excluded.tlc_vehicle_license, plate = excluded.plate, status = 'accepted', accepted_at = now();
    update public.taxi_bookings set status = 'en_route', assigned_driver = auth.uid(), assigned_driver_name = n where id = b.id;
  elsif p_type <> 'assign' then
    if not exists (select 1 from public.rides where ext_id = p_ext and (driver = auth.uid() or r in ('dispatcher','owner'))) then raise exception 'not your ride'; end if;
    update public.rides set status = case p_type when 'arrived' then 'arrived' when 'start' then 'in_progress' when 'complete' then 'completed' when 'cancel_driver' then 'cancelled_driver' else status end,
      arrived_at = case when p_type = 'arrived' then now() else arrived_at end, started_at = case when p_type = 'start' then now() else started_at end,
      completed_at = case when p_type = 'complete' then now() else completed_at end, cancelled_at = case when p_type = 'cancel_driver' then now() else cancelled_at end,
      fare = case when p_type = 'complete' and p_data ? 'fare' then (p_data->>'fare')::numeric else fare end,
      paid_at = case when p_type = 'paid' then now() else paid_at end, paid_method = case when p_type = 'paid' then left(p_data->>'method',10) else paid_method end
    where ext_id = p_ext;
    update public.taxi_bookings set status = case p_type when 'arrived' then 'arrived' when 'start' then 'in_progress' when 'complete' then 'completed' when 'cancel_driver' then 'cancelled_driver' else status end where id = b.id;
  end if;
  insert into public.ride_events (ext_id, type, actor, actor_role, data) values (left(p_ext,64), p_type, auth.uid(), r, p_data - 'pin');
end $$;

create table if not exists public.taxi_complaints (ticket text primary key, ext_id text, booking_id uuid, reason text, details text, fare numeric, driver_name text, plate text, status text not null default 'open', created_at timestamptz not null default now());
alter table public.taxi_complaints enable row level security;
create policy "dispatch reads complaints" on public.taxi_complaints for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner'));
-- Rider complaint: proves ownership of the booking with its private rider token. Returns a ticket id.
create or replace function public.file_complaint(p_id uuid, p_token uuid, p_reason text, p_details text, p_driver text, p_plate text) returns text
language plpgsql security definer set search_path to '' as $$
declare b public.taxi_bookings; t text;
begin
  select * into b from public.taxi_bookings where id = p_id and rider_token = p_token; if b.id is null then raise exception 'booking not found'; end if;
  if (select count(*) from public.taxi_complaints where booking_id = b.id) >= 5 then raise exception 'too many reports for this ride, call dispatch'; end if;
  t := 'RS-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  insert into public.taxi_complaints (ticket, ext_id, booking_id, reason, details, fare, driver_name, plate) values (t, b.ext_id, b.id, left(p_reason,40), left(p_details,500), b.fare_estimate, left(p_driver,80), left(p_plate,12));
  return t;
end $$;

revoke all on function public.save_driver_docs(jsonb), public.driver_ready(), public.review_driver(uuid,text,text,boolean), public.ride_event(text,text,jsonb) from public, anon;
grant execute on function public.save_driver_docs(jsonb), public.driver_ready(), public.review_driver(uuid,text,text,boolean), public.ride_event(text,text,jsonb) to authenticated;
grant execute on function public.driver_card(uuid), public.file_complaint(uuid,uuid,text,text,text,text) to anon, authenticated;

-- Retention: ride records and events kept 6 months, then purged nightly (03:15 UTC).
create or replace function public.purge_old_rides() returns void language sql security definer set search_path to '' as $$
  delete from public.ride_events where at < now() - interval '6 months';
  delete from public.rides where created_at < now() - interval '6 months'; $$;
revoke all on function public.purge_old_rides() from public, anon, authenticated;
select cron.schedule('rocapulco-ride-retention', '15 3 * * *', 'select public.purge_old_rides()');
