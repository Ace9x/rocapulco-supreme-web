-- 017: receipts must show the vehicle's affiliated base (35 RCNY 59B-25(i)(3)); expose it on the public driver card.
drop function if exists public.driver_card(uuid);
create function public.driver_card(p_kid uuid) returns table(name text, tlc_driver_license text, tlc_vehicle_license text, plate text, wav boolean, pay_kind text, pay_handle text, approved boolean, photo text, car text, tlc_verified boolean, tlc_checked_at timestamptz, affiliated_base text)
language sql stable security definer set search_path to '' as $$
  select coalesce(p.display_name, k.name), d.tlc_driver_license, d.tlc_vehicle_license, d.plate, coalesce(d.wav,false),
    case when d.handle_verified then d.pay_kind end, case when d.handle_verified then d.pay_handle end, d.review_status = 'approved',
    case when d.review_status = 'approved' then d.photo end, d.car,
    coalesce((d.tlc_check->>'driver_active')::boolean and (d.tlc_check->>'vehicle_active')::boolean, false), d.tlc_checked_at, coalesce(d.affiliated_base, 'B00639')
  from public.taxi_staff_keys k join public.profiles p on p.id = k.user_id left join public.taxi_driver_docs d on d.user_id = k.user_id
  where k.kid = p_kid and not k.revoked and p.taxi_role in ('driver','dispatcher','owner') $$;
revoke all on function public.driver_card(uuid) from public; grant execute on function public.driver_card(uuid) to anon, authenticated;
