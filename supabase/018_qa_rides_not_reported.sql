-- 018: QA test accounts from 015 can still run trips end to end, but their trips never enter a TLC trip-record file.
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
    if d.user_id is null or d.review_status is distinct from 'approved' then probs := probs || 'driver documents not approved by dispatch'; end if;
    if d.tlc_exp is null or d.tlc_exp < current_date then probs := probs || 'TLC driver license expired'; end if;
    if d.tlc_check is not null and (d.tlc_check->>'driver_active' = 'false' or d.tlc_check->>'vehicle_active' = 'false') then probs := probs || 'not active in NYC TLC records'; end if;
    if b.wav_requested and not coalesce(d.wav,false) then probs := probs || 'rider requested a wheelchair-accessible vehicle'; end if;
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

