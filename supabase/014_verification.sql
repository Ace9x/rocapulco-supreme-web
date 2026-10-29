-- 014: safety & verification. TLC Open Data check results, driver photo, expiry reminders,
-- read-only trip share links, driver-update column lock on bookings, rider verified flag.
alter table public.taxi_driver_docs add column if not exists photo text check (photo is null or (photo like 'data:image/jpeg;base64,%' and length(photo) < 220000));
alter table public.taxi_driver_docs add column if not exists tlc_check jsonb;
alter table public.taxi_driver_docs add column if not exists tlc_checked_at timestamptz;
alter table public.taxi_driver_docs add column if not exists car text check (car is null or length(car) <= 40);
alter table public.taxi_bookings add column if not exists share_token uuid;

-- Driver photo + car (plain profile photo for rider recognition; no face templates/biometrics are derived or stored).
create or replace function public.save_driver_photo(p_photo text, p_car text) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if (select public.taxi_role()) not in ('driver','dispatcher','owner') then raise exception 'staff only'; end if;
  insert into public.taxi_driver_docs as d (user_id, photo, car, updated_at) values (auth.uid(), p_photo, left(nullif(trim(p_car),''),40), now())
  on conflict (user_id) do update set photo = coalesce(excluded.photo, d.photo), car = coalesce(excluded.car, d.car),
    review_status = case when excluded.photo is not null and excluded.photo is distinct from d.photo then 'pending' else d.review_status end, updated_at = now();
end $$;
revoke all on function public.save_driver_photo(text,text) from public, anon; grant execute on function public.save_driver_photo(text,text) to authenticated;

-- Go-online gate now also requires approval, a photo, and a passing TLC Open Data check.
create or replace function public.driver_ready() returns table(ok boolean, problems text[])
language plpgsql stable security definer set search_path to '' as $$
declare d public.taxi_driver_docs; p text[] := '{}';
begin
  if (select public.taxi_role()) not in ('driver','dispatcher','owner') then return query select false, array['not a driver']; return; end if;
  select * into d from public.taxi_driver_docs where user_id = auth.uid();
  if d.user_id is null then return query select false, array['documents not on file']; return; end if;
  if d.tlc_driver_license is null then p := array_append(p, 'TLC driver license number missing'::text); end if;
  if d.tlc_vehicle_license is null then p := array_append(p, 'TLC vehicle (FHV) license number missing'::text); end if;
  if d.dmv_exp is null or d.dmv_exp < current_date then p := array_append(p, 'DMV driver license expired or missing'::text); end if;
  if d.tlc_exp is null or d.tlc_exp < current_date then p := array_append(p, 'TLC driver license expired or missing'::text); end if;
  if d.reg_exp is null or d.reg_exp < current_date then p := array_append(p, 'vehicle registration expired or missing'::text); end if;
  if d.ins_exp is null or d.ins_exp < current_date then p := array_append(p, 'insurance expired or missing'::text); end if;
  if d.photo is null then p := array_append(p, 'profile photo missing (riders use it to recognise you)'::text); end if;
  if coalesce((d.tlc_check->>'driver_active')::boolean,false) is false then p := array_append(p, 'TLC driver license not found as active in NYC TLC records (run the TLC check)'::text); end if;
  if coalesce((d.tlc_check->>'vehicle_active')::boolean,false) is false then p := array_append(p, 'FHV vehicle license not found as active in NYC TLC records (run the TLC check)'::text); end if;
  if d.review_status <> 'approved' then p := array_append(p, ('dispatch review: ' || d.review_status)::text); end if;
  return query select coalesce(array_length(p,1),0) = 0, p;
end $$;

-- Rider-facing card: adds photo, car, TLC record match.
drop function if exists public.driver_card(uuid);
create function public.driver_card(p_kid uuid) returns table(name text, tlc_driver_license text, tlc_vehicle_license text, plate text, wav boolean, pay_kind text, pay_handle text, approved boolean, photo text, car text, tlc_verified boolean, tlc_checked_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select coalesce(p.display_name, k.name), d.tlc_driver_license, d.tlc_vehicle_license, d.plate, coalesce(d.wav,false),
    case when d.handle_verified then d.pay_kind end, case when d.handle_verified then d.pay_handle end, d.review_status = 'approved',
    case when d.review_status = 'approved' then d.photo end, d.car,
    coalesce((d.tlc_check->>'driver_active')::boolean and (d.tlc_check->>'vehicle_active')::boolean, false), d.tlc_checked_at
  from public.taxi_staff_keys k join public.profiles p on p.id = k.user_id left join public.taxi_driver_docs d on d.user_id = k.user_id
  where k.kid = p_kid and not k.revoked and p.taxi_role in ('driver','dispatcher','owner') $$;
grant execute on function public.driver_card(uuid) to anon, authenticated;

-- Expiry reminders: documents expiring within N days (driver sees own; dispatch sees all).
create or replace function public.expiring_docs(p_days int default 30) returns table(user_id uuid, name text, doc text, expires date, days_left int)
language sql stable security definer set search_path to '' as $$
  select d.user_id, p.display_name, x.doc, x.exp, (x.exp - current_date)::int
  from public.taxi_driver_docs d join public.profiles p on p.id = d.user_id
  cross join lateral (values ('DMV driver license', d.dmv_exp), ('TLC driver license', d.tlc_exp), ('Vehicle registration', d.reg_exp), ('Insurance', d.ins_exp)) x(doc, exp)
  where x.exp is not null and x.exp <= current_date + least(greatest(p_days,1),120)
    and (d.user_id = auth.uid() or (select public.taxi_role()) in ('dispatcher','owner'))
  order by x.exp $$;
revoke all on function public.expiring_docs(int) from public, anon; grant execute on function public.expiring_docs(int) to authenticated;

-- Read-only trip share: the rider mints a separate token (never the cancel token) for a trusted contact.
create or replace function public.ride_share_token(p_id uuid, p_token uuid) returns uuid
language plpgsql security definer set search_path to '' as $$
declare s uuid;
begin
  update public.taxi_bookings set share_token = coalesce(share_token, gen_random_uuid()) where id = p_id and rider_token = p_token returning share_token into s;
  if s is null then raise exception 'not your booking'; end if; return s;
end $$;
create or replace function public.ride_shared(p_share uuid) returns table(status text, driver text, plate text, car text, pickup text, dropoff text, updated_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select b.status, b.assigned_driver_name, r.plate, d.car, b.pickup_address, b.dropoff_address, b.updated_at
  from public.taxi_bookings b left join public.rides r on r.booking_id = b.id left join public.taxi_driver_docs d on d.user_id = b.assigned_driver
  where b.share_token = p_share and b.created_at > now() - interval '24 hours' $$;
revoke all on function public.ride_share_token(uuid,uuid), public.ride_shared(uuid) from public;
grant execute on function public.ride_share_token(uuid,uuid), public.ride_shared(uuid) to anon, authenticated;

-- Drivers may only move a booking's status; they can't rewrite fare, rider or addresses.
create or replace function public.lock_driver_booking_cols() returns trigger language plpgsql set search_path to '' as $$
begin
  if (select public.taxi_role()) in ('dispatcher','owner') or auth.uid() is null then return new; end if;
  if old.assigned_driver = auth.uid() and (new.rider, new.rider_name, new.rider_phone, new.pickup_address, new.pickup_lat, new.pickup_lng, new.dropoff_address, new.dropoff_lat, new.dropoff_lng, new.fare_estimate, new.payment_method, new.rider_token, new.share_token, new.assigned_driver, new.ext_id)
     is distinct from (old.rider, old.rider_name, old.rider_phone, old.pickup_address, old.pickup_lat, old.pickup_lng, old.dropoff_address, old.dropoff_lat, old.dropoff_lng, old.fare_estimate, old.payment_method, old.rider_token, old.share_token, old.assigned_driver, old.ext_id)
  then raise exception 'drivers can only change trip status'; end if;
  return new;
end $$;
drop trigger if exists t_lock_driver_cols on public.taxi_bookings;
create trigger t_lock_driver_cols before update on public.taxi_bookings for each row execute function public.lock_driver_booking_cols();
