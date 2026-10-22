-- 006: signed relay messages. Staff (driver/dispatcher/owner) register an ECDSA P-256 public key;
-- anyone can look up a key by id to verify signatures. Riders sign with a per-trip key stored on the booking.
create table if not exists public.taxi_staff_keys (
  kid uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pubkey jsonb not null, role text not null, name text,
  created_at timestamptz not null default now(), revoked boolean not null default false);
alter table public.taxi_staff_keys enable row level security;
create policy "own keys readable" on public.taxi_staff_keys for select to authenticated using (user_id = (select auth.uid()));
alter table public.taxi_bookings add column if not exists rider_pub jsonb;

create or replace function public.register_staff_key(p_pub jsonb) returns uuid
language plpgsql security definer set search_path to '' as $$
declare r text := (select public.taxi_role()); k uuid; n text;
begin
  if r not in ('driver','dispatcher','owner') then raise exception 'staff only'; end if;
  if jsonb_typeof(p_pub) <> 'object' or p_pub->>'kty' <> 'EC' or p_pub->>'crv' <> 'P-256' or p_pub ? 'd' then raise exception 'bad key'; end if;
  if (select count(*) from public.taxi_staff_keys where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then raise exception 'too many keys'; end if;
  select display_name into n from public.profiles where id = auth.uid();
  insert into public.taxi_staff_keys (user_id, pubkey, role, name) values (auth.uid(), jsonb_build_object('kty','EC','crv','P-256','x',p_pub->>'x','y',p_pub->>'y'), r, n) returning kid into k;
  return k;
end $$;

-- role is re-read from profiles at lookup, so demoting a user revokes their keys immediately.
create or replace function public.staff_key(p_kid uuid) returns table(pubkey jsonb, role text, name text)
language sql stable security definer set search_path to '' as $$
  select k.pubkey, p.taxi_role, coalesce(p.display_name, k.name) from public.taxi_staff_keys k join public.profiles p on p.id = k.user_id
  where k.kid = p_kid and not k.revoked and p.taxi_role in ('driver','dispatcher','owner') $$;

-- staff check that a relay request matches a real server booking (and get the rider's per-trip key).
create or replace function public.verify_booking(p_ext text) returns table(fare_estimate numeric, vehicle_class text, status text, rider_pub jsonb, pickup_address text, dropoff_address text)
language sql stable security definer set search_path to '' as $$
  select b.fare_estimate, b.vehicle_class, b.status, b.rider_pub, b.pickup_address, b.dropoff_address from public.taxi_bookings b
  where b.ext_id = p_ext and (select public.taxi_role()) in ('driver','dispatcher','owner') $$;

revoke all on function public.register_staff_key(jsonb) from public, anon;
grant execute on function public.register_staff_key(jsonb) to authenticated;
grant execute on function public.staff_key(uuid) to anon, authenticated;
revoke all on function public.verify_booking(text) from public, anon;
grant execute on function public.verify_booking(text) to authenticated;

create or replace function public.book_ride(p jsonb)
 returns table(id uuid, token uuid, fare_estimate numeric)
 language plpgsql security definer set search_path to '' as $function$
declare r public.taxi_bookings; ph text := left(regexp_replace(coalesce(p->>'rider_phone',''), '[^0-9+]', '', 'g'), 20);
  rp jsonb := case when jsonb_typeof(p->'rider_pub') = 'object' and p->'rider_pub'->>'kty' = 'EC' then jsonb_build_object('kty','EC','crv','P-256','x',p->'rider_pub'->>'x','y',p->'rider_pub'->>'y') end;
begin
  if coalesce(p->>'pickup_address','') = '' or coalesce(p->>'dropoff_address','') = '' then raise exception 'pickup and dropoff required'; end if;
  if ph <> '' and (select count(*) from public.taxi_bookings b where b.rider_phone = ph and b.created_at > now() - interval '1 hour') >= 6 then raise exception 'too many bookings from this phone, call dispatch'; end if;
  if (select count(*) from public.taxi_bookings b where b.created_at > now() - interval '1 minute') >= 30 then raise exception 'busy, try again or call dispatch'; end if;
  insert into public.taxi_bookings (ext_id, rider, rider_name, rider_phone, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, est_miles, est_minutes, flat_rate, vehicle_class, payment_method, scheduled_for, rider_pub)
  values (left(p->>'ext_id', 64), (select auth.uid()), left(p->>'rider_name', 80), nullif(ph,''), left(p->>'pickup_address', 200), (p->>'pickup_lat')::float8, (p->>'pickup_lng')::float8, left(p->>'dropoff_address', 200), (p->>'dropoff_lat')::float8, (p->>'dropoff_lng')::float8,
    least(greatest((p->>'est_miles')::numeric, 0), 500), least(greatest((p->>'est_minutes')::numeric, 0), 1000), case when upper(p->>'flat_rate') in ('JFK','LGA') then upper(p->>'flat_rate') end,
    case when lower(p->>'vehicle_class') = 'suv' then 'suv' else 'sedan' end,
    case when lower(p->>'payment_method') in ('cash','card','zelle','venmo') then lower(p->>'payment_method') else 'cash' end, (p->>'scheduled_for')::timestamptz, rp)
  on conflict (ext_id) where ext_id is not null do nothing returning * into r;
  if r.id is null then raise exception 'duplicate booking'; end if;
  return query select r.id, r.rider_token, r.fare_estimate;
end $function$;
