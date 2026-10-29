-- 016: TLC trip records (35 RCNY 59B-19) + filed rate schedule (59B-21(a), 59B-23, 59B-25(g),(i)).
-- Sources (read 2026-10-28):
--   Rule book ch.59: https://www.nyc.gov/assets/tlc/downloads/pdf/rule_book_current_chapter_59.pdf
--   Submission page: https://www.nyc.gov/site/tlc/tlc-online/fhv-trip-record-submission.page
--   CSV spec header: https://www.nyc.gov/assets/tlc/downloads/csv/csv_spec_template_November2018-FINAL.CSV
--   CSV manual: https://www.nyc.gov/assets/tlc/downloads/pdf/csv_instruction_manual.pdf
--   Field formats: https://www.nyc.gov/assets/tlc/downloads/pdf/tlc_trip_data_example_6_7_23.pdf
--   FAQ (completed trips only): https://www.nyc.gov/assets/tlc/downloads/pdf/efhv_faqs.pdf

-- ===== Rate schedule: the ONE server copy of the base's rates (mirrors RATE_SCHEDULE in fare.js; tests/tlc.test.mjs checks parity) =====
create table if not exists public.taxi_rate_schedule (
  version int primary key, effective_from date not null,
  base numeric(8,2) not null, per_mile numeric(8,2) not null, per_minute numeric(8,2) not null, minimum numeric(8,2) not null,
  jfk_flat numeric(8,2) not null, lga_flat numeric(8,2) not null, suv_mult numeric(4,2) not null,
  price_multiplier boolean not null default false check (price_multiplier = false), -- no surge / variable pricing
  extra_fees jsonb not null default '[]' check (extra_fees = '[]'::jsonb),            -- no fees beyond the schedule
  filed_with_tlc_confirmed boolean not null default false, filed_note text, created_at timestamptz not null default now());
alter table public.taxi_rate_schedule enable row level security;
drop policy if exists "rates are public" on public.taxi_rate_schedule;
create policy "rates are public" on public.taxi_rate_schedule for select to anon, authenticated using (true);
insert into public.taxi_rate_schedule (version, effective_from, base, per_mile, per_minute, minimum, jfk_flat, lga_flat, suv_mult, filed_note)
values (1, '2026-10-28', 3.50, 2.50, 0.40, 10.00, 75.00, 82.50, 1.5, 'TODO(Fan): confirm these equal the Rate Schedule on file with TLC for B00639') on conflict do nothing;
create or replace function public.current_rates() returns public.taxi_rate_schedule language sql stable security definer set search_path to '' as $$
  select * from public.taxi_rate_schedule where effective_from <= (now() at time zone 'America/New_York')::date order by effective_from desc, version desc limit 1 $$;
-- Same math, same rounding, as estimateFare() in fare.js (per-line rounding on 2-dp miles and whole minutes).
create or replace function public.rate_quote(p_miles numeric, p_minutes numeric, p_flat text, p_class text) returns numeric language plpgsql stable security definer set search_path to '' as $$
declare s public.taxi_rate_schedule := public.current_rates(); k numeric := case when p_class = 'suv' then s.suv_mult else 1 end; m numeric := round(coalesce(p_miles,0),2); t numeric := round(coalesce(p_minutes,0)); sub numeric;
begin
  if p_flat = 'JFK' then return round(s.jfk_flat * k, 2); elsif p_flat = 'LGA' then return round(s.lga_flat * k, 2); end if;
  sub := round(s.base * k, 2) + round(m * s.per_mile * k, 2) + round(t * s.per_minute * k, 2);
  return round(greatest(sub, round(s.minimum * k, 2)), 2);
end $$;
grant execute on function public.current_rates(), public.rate_quote(numeric,numeric,text,text) to anon, authenticated;

-- ===== Booking: binding quote + TLC request fields =====
alter table public.taxi_bookings add column if not exists wav_requested boolean not null default false,
  add column if not exists shared_request boolean not null default false, add column if not exists client_quote numeric,
  add column if not exists quote_total numeric, add column if not exists rate_version int, add column if not exists requote_count int not null default 0;
create or replace function public.lock_quote() returns trigger language plpgsql set search_path to '' as $$
declare q numeric := public.rate_quote(new.est_miles, new.est_minutes, new.flat_rate, new.vehicle_class);
begin
  if tg_op = 'UPDATE' and (new.quote_total, new.rate_version) is not distinct from (old.quote_total, old.rate_version)
     and (new.est_miles, new.est_minutes, new.flat_rate, new.vehicle_class) is not distinct from (old.est_miles, old.est_minutes, old.flat_rate, old.vehicle_class) then return new; end if;
  if tg_op = 'UPDATE' and current_setting('rocapulco.requote', true) is distinct from 'on' then
    new.quote_total := old.quote_total; new.rate_version := old.rate_version; new.est_miles := old.est_miles; new.est_minutes := old.est_minutes; new.flat_rate := old.flat_rate; new.vehicle_class := old.vehicle_class; return new; end if;
  -- binding quote never above the filed schedule and never above what the rider was shown
  new.quote_total := least(q, coalesce(new.client_quote, q)); new.rate_version := (public.current_rates()).version; return new;
end $$;
drop trigger if exists t_lock_quote on public.taxi_bookings;
create trigger t_lock_quote before insert or update on public.taxi_bookings for each row execute function public.lock_quote();
update public.taxi_bookings set quote_total = fare_estimate, rate_version = 1 where quote_total is null;

create or replace function public.book_ride(p jsonb) returns table(id uuid, token uuid, fare_estimate numeric)
language plpgsql security definer set search_path to '' as $$
declare r public.taxi_bookings; ph text := left(regexp_replace(coalesce(p->>'rider_phone',''), '[^0-9+]', '', 'g'), 20);
  rp jsonb := case when jsonb_typeof(p->'rider_pub') = 'object' and p->'rider_pub'->>'kty' = 'EC' then jsonb_build_object('kty','EC','crv','P-256','x',p->'rider_pub'->>'x','y',p->'rider_pub'->>'y') end;
begin
  if coalesce(p->>'pickup_address','') = '' or coalesce(p->>'dropoff_address','') = '' then raise exception 'pickup and dropoff required'; end if;
  if ph <> '' and (select count(*) from public.taxi_bookings b where b.rider_phone = ph and b.created_at > now() - interval '1 hour') >= 6 then raise exception 'too many bookings from this phone, call dispatch'; end if;
  if (select count(*) from public.taxi_bookings b where b.created_at > now() - interval '1 minute') >= 30 then raise exception 'busy, try again or call dispatch'; end if;
  insert into public.taxi_bookings (ext_id, rider, rider_name, rider_phone, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, est_miles, est_minutes, flat_rate, vehicle_class, payment_method, scheduled_for, rider_pub, wav_requested, client_quote)
  values (left(p->>'ext_id', 64), (select auth.uid()), left(p->>'rider_name', 80), nullif(ph,''), left(p->>'pickup_address', 200), (p->>'pickup_lat')::float8, (p->>'pickup_lng')::float8, left(p->>'dropoff_address', 200), (p->>'dropoff_lat')::float8, (p->>'dropoff_lng')::float8,
    least(greatest((p->>'est_miles')::numeric, 0), 500), least(greatest((p->>'est_minutes')::numeric, 0), 1000), case when upper(p->>'flat_rate') in ('JFK','LGA') then upper(p->>'flat_rate') end,
    case when lower(p->>'vehicle_class') = 'suv' then 'suv' else 'sedan' end,
    case when lower(p->>'payment_method') in ('cash','card','zelle','venmo') then lower(p->>'payment_method') else 'cash' end, (p->>'scheduled_for')::timestamptz, rp,
    coalesce((p->>'wav')::boolean, false), nullif(p->>'quote','')::numeric)
  on conflict (ext_id) where ext_id is not null do nothing returning * into r;
  if r.id is null then raise exception 'duplicate booking'; end if;
  return query select r.id, r.rider_token, r.quote_total;
end $$;

-- Rider changes the destination (59B-23(b)(3) allows a new quote only then): new binding quote from the schedule.
create or replace function public.rider_requote(p_id uuid, p_token uuid, p jsonb) returns numeric language plpgsql security definer set search_path to '' as $$
declare r public.taxi_bookings;
begin
  perform set_config('rocapulco.requote', 'on', true);
  update public.taxi_bookings b set dropoff_address = left(p->>'dropoff_address',200), dropoff_lat = (p->>'dropoff_lat')::float8, dropoff_lng = (p->>'dropoff_lng')::float8,
    est_miles = least(greatest((p->>'est_miles')::numeric,0),500), est_minutes = least(greatest((p->>'est_minutes')::numeric,0),1000),
    flat_rate = case when upper(p->>'flat_rate') in ('JFK','LGA') then upper(p->>'flat_rate') end, client_quote = nullif(p->>'quote','')::numeric, requote_count = b.requote_count + 1
  where b.id = p_id and b.rider_token = p_token and b.status not in ('completed','cancelled_rider','cancelled_driver') and b.requote_count < 5 returning * into r;
  perform set_config('rocapulco.requote', 'off', true);
  if r.id is null then raise exception 'cannot change this ride'; end if;
  update public.rides set dropoff_address = r.dropoff_address, dropoff_lat = r.dropoff_lat, dropoff_lng = r.dropoff_lng, quote_total = r.quote_total where ext_id = r.ext_id and status not in ('completed','cancelled_driver','cancelled_rider');
  insert into public.ride_events (ext_id, type, actor_role, data) values (r.ext_id, 'requote', 'rider', jsonb_build_object('quote', r.quote_total, 'rate_version', r.rate_version));
  return r.quote_total;
end $$;
revoke all on function public.rider_requote(uuid,uuid,jsonb) from public; grant execute on function public.rider_requote(uuid,uuid,jsonb) to anon, authenticated;

-- ===== Ride (trip) record: every 59B-19(a)(1) field, snapshotted at dispatch =====
alter table public.taxi_driver_docs add column if not exists affiliated_base text not null default 'B00639';
alter table public.taxi_driver_docs drop constraint if exists docs_aff_base_fmt;
alter table public.taxi_driver_docs add constraint docs_aff_base_fmt check (affiliated_base ~ '^B[0-9]{5}$');
alter table public.rides add column if not exists dispatching_base text, add column if not exists affiliated_base text,
  add column if not exists pickup_address text, add column if not exists pickup_lat double precision, add column if not exists pickup_lng double precision,
  add column if not exists dropoff_address text, add column if not exists dropoff_lat double precision, add column if not exists dropoff_lng double precision,
  add column if not exists flat_rate text, add column if not exists request_at timestamptz, add column if not exists wav_requested boolean,
  add column if not exists shared_request boolean not null default false, add column if not exists shared_match boolean not null default false,
  add column if not exists quote_total numeric, add column if not exists rate_version int, add column if not exists cancelled_by text, add column if not exists tlc_file_id bigint;

-- TLC license sanity (format only; NYC Open Data activity check is in tlc_check from 014).
create or replace function public.tlc_license_problems(p_drv text, p_veh text, p_plate text, p_disp text, p_aff text) returns text[] language sql immutable set search_path to '' as $$
  select array_remove(array[
    case when coalesce(p_drv,'') !~ '^[0-9]{4,10}$' then 'TLC driver license # missing/invalid' end,
    case when coalesce(p_veh,'') !~ '^[A-Za-z0-9-]{4,12}$' then 'TLC vehicle license # missing/invalid' end,
    case when coalesce(p_plate,'') !~ '^[A-Za-z0-9]{2,8}$' then 'vehicle plate missing/invalid' end,
    case when coalesce(p_disp,'') !~ '^B[0-9]{5}$' then 'dispatching base # invalid' end,
    case when coalesce(p_aff,'') !~ '^B[0-9]{5}$' then 'affiliated base # invalid' end], null) $$;

create or replace function public.ride_event(p_ext text, p_type text, p_data jsonb default '{}') returns void
language plpgsql security definer set search_path to '' as $$
declare r text := (select public.taxi_role()); d public.taxi_driver_docs; b public.taxi_bookings; n text; x public.rides; probs text[]; f numeric;
  disp constant text := 'B00639';
begin
  if r not in ('driver','dispatcher','owner') then raise exception 'staff only'; end if;
  if p_type not in ('accept','arrived','start','complete','cancel_driver','paid','assign','pin_ok') then raise exception 'bad event'; end if;
  select * into d from public.taxi_driver_docs where user_id = auth.uid(); select * into b from public.taxi_bookings where ext_id = p_ext; select display_name into n from public.profiles where id = auth.uid();
  if p_type = 'accept' then
    -- 59B-19(a)(1)(ii)-(v) + 77-20(c)(2): no dispatch without valid driver, vehicle and base license numbers
    probs := public.tlc_license_problems(d.tlc_driver_license, d.tlc_vehicle_license, d.plate, disp, d.affiliated_base);
    if d.user_id is null or d.review_status is distinct from 'approved' then probs := probs || 'driver documents not approved by dispatch'; end if;
    if d.tlc_exp is null or d.tlc_exp < current_date then probs := probs || 'TLC driver license expired'; end if;
    if d.tlc_check is not null and (d.tlc_check->>'driver_active' = 'false' or d.tlc_check->>'vehicle_active' = 'false') then probs := probs || 'not active in NYC TLC records'; end if;
    if b.wav_requested and not coalesce(d.wav,false) then probs := probs || 'rider requested a wheelchair-accessible vehicle'; end if;
    if coalesce(array_length(probs,1),0) > 0 then raise exception 'cannot dispatch: %', array_to_string(probs, '; '); end if;
    if b.id is null then raise exception 'no server booking for this trip'; end if;
    select * into x from public.rides where ext_id = p_ext;
    if x.started_at is not null then raise exception 'trip already started'; end if;
    insert into public.rides (ext_id, booking_id, driver, driver_name, tlc_driver_license, tlc_vehicle_license, plate, base_number, dispatching_base, affiliated_base, vehicle_class, wav, wav_requested, shared_request,
      pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, flat_rate, request_at, quote_total, rate_version, fare, status, accepted_at)
    values (left(p_ext,64), b.id, auth.uid(), n, d.tlc_driver_license, d.tlc_vehicle_license, upper(d.plate), disp, disp, d.affiliated_base, b.vehicle_class, coalesce(d.wav,false), b.wav_requested, b.shared_request,
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

-- Rider cancels after a driver was assigned: mark the trip record cancelled by passenger (59B-19(a)(1)(vii)).
create or replace function public.rider_cancel(p_id uuid, p_token uuid) returns text language plpgsql security definer set search_path to '' as $$
declare s text; e text;
begin
  update public.taxi_bookings set status = 'cancelled_rider' where id = p_id and rider_token = p_token and status in ('requested','assigned','en_route','arrived') returning status, ext_id into s, e;
  if e is not null then update public.rides set status = 'cancelled_rider', cancelled_at = now(), cancelled_by = 'passenger' where ext_id = e and started_at is null; end if;
  return s;
end $$;

-- ===== Immutability + audit =====
create table if not exists public.ride_audit (id bigserial primary key, ext_id text not null, op text not null, old jsonb, new jsonb, actor uuid, at timestamptz not null default now());
alter table public.ride_audit enable row level security;
drop policy if exists "dispatch reads audit" on public.ride_audit;
create policy "dispatch reads audit" on public.ride_audit for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner'));
create or replace function public.rides_guard() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('rocapulco.purge', true) = 'on' and old.created_at < now() - interval '19 months' then return old; end if;
    raise exception 'trip records are kept 18+ months and cannot be deleted';
  end if;
  if old.status = 'cancelled_driver' and old.started_at is null and new.status = 'accepted' then return new; end if; -- reassigned before pickup
  if old.status in ('completed','cancelled_driver','cancelled_rider') then
    -- closed record: only payment confirmation and the TLC file link may be added, once
    if (to_jsonb(new) - array['paid_at','paid_method','tlc_file_id']) is distinct from (to_jsonb(old) - array['paid_at','paid_method','tlc_file_id'])
       or (old.paid_at is not null and new.paid_at is distinct from old.paid_at) or (old.tlc_file_id is not null and new.tlc_file_id is distinct from old.tlc_file_id and current_setting('rocapulco.tlcfile', true) is distinct from 'on')
    then raise exception 'closed trip records are immutable'; end if;
  elsif old.started_at is not null and (new.tlc_driver_license, new.tlc_vehicle_license, new.plate, new.dispatching_base, new.affiliated_base, new.driver, new.started_at, new.pickup_address, new.pickup_lat, new.pickup_lng)
        is distinct from (old.tlc_driver_license, old.tlc_vehicle_license, old.plate, old.dispatching_base, old.affiliated_base, old.driver, old.started_at, old.pickup_address, old.pickup_lat, old.pickup_lng) then
    raise exception 'driver, vehicle, base and pickup are locked once the passenger is on board';
  end if;
  return new;
end $$;
drop trigger if exists t_rides_guard on public.rides;
create trigger t_rides_guard before update or delete on public.rides for each row execute function public.rides_guard();
create or replace function public.rides_audit() returns trigger language plpgsql security definer set search_path to '' as $$
begin insert into public.ride_audit (ext_id, op, old, new, actor) values (coalesce(new.ext_id, old.ext_id), tg_op, case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end, auth.uid()); return null; end $$;
drop trigger if exists t_rides_audit on public.rides;
create trigger t_rides_audit after insert or update or delete on public.rides for each row execute function public.rides_audit();
create or replace function public.append_only() returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'DELETE' and current_setting('rocapulco.purge', true) = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;
drop trigger if exists t_events_append_only on public.ride_events;
create trigger t_events_append_only before update or delete on public.ride_events for each row execute function public.append_only();
drop trigger if exists t_audit_append_only on public.ride_audit;
create trigger t_audit_append_only before update or delete on public.ride_audit for each row execute function public.append_only();

-- ===== TLC monthly CSV (exact 26-column header, CRLF, MM-DD-YYYY, HH24:MI:SS Eastern) =====
create table if not exists public.tlc_report_files (id bigserial primary key, period_start date not null, period_end date not null, filename text not null,
  csv text not null, row_count int not null, late_rows int not null default 0, cancelled_count int not null default 0, problems jsonb not null default '[]', sha256 text not null,
  due_date date not null, generated_at timestamptz not null default now(), generated_by uuid, submitted_at timestamptz, submitted_by uuid, submitted_note text);
alter table public.tlc_report_files enable row level security;
drop policy if exists "dispatch reads tlc files" on public.tlc_report_files;
create policy "dispatch reads tlc files" on public.tlc_report_files for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner'));

create or replace function public.tlc_csv_cell(v text) returns text language sql immutable set search_path to '' as $$
  select case when v is null then '' when v ~ '[",\r\n]' then '"' || replace(v, '"', '""') || '"' else v end $$;
create or replace function public.tlc_loc_type(addr text, flat text) returns text language sql immutable set search_path to '' as $$
  select case when flat in ('JFK','LGA') or coalesce(addr,'') ~* '(\mJFK\M|kennedy international|laguardia|la guardia|\mLGA\M|newark liberty|\mEWR\M)' then 'Airport'
              when coalesce(addr,'') ~* '(\s&\s|\sand\s|\s@\s|/)' and coalesce(addr,'') !~ '^\s*[0-9]' then 'Intersection of' else 'Exact Address' end $$;

-- One row per completed trip, in TLC column order. Pickup flat-rate tag only applies to dropoff (airport flat rates are TO the airport).
create or replace function public.tlc_rows(p_until timestamptz) returns table(ext_id text, line text, problems text[]) language sql stable security definer set search_path to '' as $$
  with t as (select r.*, (r.started_at at time zone 'America/New_York') pu, (r.completed_at at time zone 'America/New_York') dof, (r.request_at at time zone 'America/New_York') rq
             from public.rides r where r.status = 'completed' and r.tlc_file_id is null and r.started_at < p_until and r.dispatching_base is not null)
  select t.ext_id,
    array_to_string(array[t.dispatching_base, to_char(t.pu,'MM-DD-YYYY'), to_char(t.pu,'HH24:MI:SS'), t.tlc_driver_license, t.plate, t.affiliated_base,
      public.tlc_loc_type(t.pickup_address, null), public.tlc_csv_cell(t.pickup_address), to_char(t.pickup_lng,'FM990.000000'), to_char(t.pickup_lat,'FM990.000000'),
      to_char(t.dof,'MM-DD-YYYY'), to_char(t.dof,'HH24:MI:SS'), public.tlc_loc_type(t.dropoff_address, t.flat_rate), public.tlc_csv_cell(t.dropoff_address),
      to_char(t.dropoff_lng,'FM990.000000'), to_char(t.dropoff_lat,'FM990.000000'),
      '', case when t.shared_request then 'Y' else 'N' end, case when t.shared_match then 'Y' else 'N' end, 'N', case when t.wav_requested then 'Y' else 'N' end,
      to_char(t.rq,'MM-DD-YYYY'), to_char(t.rq,'HH24:MI:SS'), '', '', ''], ',', ''),
    public.tlc_license_problems(t.tlc_driver_license, t.tlc_vehicle_license, t.plate, t.dispatching_base, t.affiliated_base)
      || case when t.completed_at is null then array['no drop-off time'] else '{}'::text[] end
      || case when coalesce(t.pickup_address,'') = '' and t.pickup_lat is null then array['no pickup location'] else '{}'::text[] end
      || case when coalesce(t.dropoff_address,'') = '' and t.dropoff_lat is null then array['no drop-off location'] else '{}'::text[] end
  from t order by t.started_at $$;
revoke all on function public.tlc_rows(timestamptz) from public, anon, authenticated;

create or replace function public.tlc_generate_report(p_start date default null, p_end date default null) returns public.tlc_report_files
language plpgsql security definer set search_path to '' as $$
declare s date := coalesce(p_start, date_trunc('month', (now() at time zone 'America/New_York') - interval '1 month')::date);
  e date := coalesce(p_end, (date_trunc('month', s) + interval '1 month - 1 day')::date);
  hdr constant text := 'dispatching_base_number,pickup_date,pickup_time,TLC_drivers_license_number,license_plate,affiliated_base_number,pickup_location_type,pickup_location_name,pickup_longitude,pickup_latitude,dropoff_date,dropoff_time,dropoff_location_type,dropoff_location_name,dropoff_longitude,dropoff_latitude,congestion_zone_flag,shared_request_flag,shared_match_flag,access_a_ride_flag,WAV_request_flag,request_date,request_time,originating_base_number,on_scene_date,on_scene_time';
  until_ts timestamptz := ((e + 1)::timestamp at time zone 'America/New_York'); body text; n int; late int; probs jsonb; cx int; f public.tlc_report_files; old public.tlc_report_files;
begin
  if auth.uid() is not null and (select public.taxi_role()) not in ('dispatcher','owner') then raise exception 'dispatch only'; end if;
  if e < s or e >= (now() at time zone 'America/New_York')::date then raise exception 'period must be a past date range'; end if;
  -- regenerating an unsubmitted file for the same period releases its trips first
  select * into old from public.tlc_report_files where period_start = s and period_end = e and submitted_at is null order by id desc limit 1;
  if old.id is not null then perform set_config('rocapulco.tlcfile','on',true); update public.rides set tlc_file_id = null where tlc_file_id = old.id; delete from public.tlc_report_files where id = old.id; end if;
  select coalesce(string_agg(x.line, E'\r\n'), ''), count(*), coalesce(jsonb_agg(jsonb_build_object('trip', x.ext_id, 'problems', to_jsonb(x.problems))) filter (where cardinality(x.problems) > 0), '[]')
    into body, n, probs from public.tlc_rows(until_ts) x;
  select count(*) into late from public.rides r where r.status = 'completed' and r.tlc_file_id is null and r.started_at < (s::timestamp at time zone 'America/New_York') and r.dispatching_base is not null;
  select count(*) into cx from public.rides r where r.status like 'cancelled%' and r.cancelled_at >= (s::timestamp at time zone 'America/New_York') and r.cancelled_at < until_ts;
  body := hdr || E'\r\n' || body || case when n > 0 then E'\r\n' else '' end;
  insert into public.tlc_report_files (period_start, period_end, filename, csv, row_count, late_rows, cancelled_count, problems, sha256, due_date, generated_by)
  values (s, e, 'B00639_' || to_char(s,'YYYYMMDD') || '-' || to_char(e,'YYYYMMDD') || '.csv', body, n, late, cx, probs, encode(extensions.digest(body, 'sha256'), 'hex'),
    (date_trunc('month', e) + interval '2 month - 1 day')::date, auth.uid()) returning * into f;
  perform set_config('rocapulco.tlcfile','on',true);
  update public.rides r set tlc_file_id = f.id where r.ext_id in (select x.ext_id from public.tlc_rows(until_ts) x);
  return f;
end $$;
create or replace function public.tlc_reports() returns table(id bigint, period_start date, period_end date, filename text, row_count int, late_rows int, cancelled_count int, problems jsonb, sha256 text, due_date date, generated_at timestamptz, submitted_at timestamptz, submitted_note text)
language sql stable security definer set search_path to '' as $$
  select id, period_start, period_end, filename, row_count, late_rows, cancelled_count, problems, sha256, due_date, generated_at, submitted_at, submitted_note from public.tlc_report_files
  where (select public.taxi_role()) in ('dispatcher','owner') order by period_start desc, id desc $$;
create or replace function public.tlc_report_csv(p_id bigint) returns text language sql stable security definer set search_path to '' as $$
  select csv from public.tlc_report_files where id = p_id and (select public.taxi_role()) in ('dispatcher','owner') $$;
create or replace function public.tlc_mark_submitted(p_id bigint, p_note text) returns void language plpgsql security definer set search_path to '' as $$
begin
  if (select public.taxi_role()) is distinct from 'owner' then raise exception 'owner only'; end if;
  update public.tlc_report_files set submitted_at = now(), submitted_by = auth.uid(), submitted_note = left(p_note, 200) where id = p_id and submitted_at is null;
end $$;
revoke all on function public.tlc_generate_report(date,date), public.tlc_reports(), public.tlc_report_csv(bigint), public.tlc_mark_submitted(bigint,text) from public, anon;
grant execute on function public.tlc_generate_report(date,date), public.tlc_reports(), public.tlc_report_csv(bigint), public.tlc_mark_submitted(bigint,text) to authenticated;
-- Monthly: 06:00 New York on the 2nd (10:00/11:00 UTC) builds last month's file, leaving ~4 weeks before the last-day-of-month deadline
-- and inside TLC's first-14-days early-rejection window.
select cron.unschedule(jobid) from cron.job where jobname = 'rocapulco-tlc-monthly';
select cron.schedule('rocapulco-tlc-monthly', '0 11 2 * *', 'select public.tlc_generate_report()');

-- Retention purge (019 months) now has to switch on the purge flag to get past the immutability guards.
create or replace function public.purge_old_rides() returns void language plpgsql security definer set search_path to '' as $$
begin
  perform set_config('rocapulco.purge', 'on', true);
  delete from public.ride_events where at < now() - interval '19 months';
  delete from public.ride_audit where at < now() - interval '19 months';
  delete from public.rides where created_at < now() - interval '19 months';
  delete from public.taxi_complaints where created_at < now() - interval '19 months' and status is distinct from 'open';
  delete from public.taxi_bookings b where b.created_at < now() - interval '19 months'
    and not exists (select 1 from public.taxi_complaints c where (c.booking_id = b.id or c.ext_id = b.ext_id) and c.status = 'open');
  delete from public.tlc_report_files where generated_at < now() - interval '19 months';
  delete from public.taxi_applications where updated_at < now() - interval '6 months' and status in ('declined','draft');
end $$;
revoke all on function public.purge_old_rides() from public, anon, authenticated;
