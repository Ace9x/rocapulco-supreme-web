-- 008: only the driver who accepted an active ride can read the rider's phone (relay messages carry last 4 only).
create or replace function public.rider_contact(p_ext text) returns table(rider_name text, rider_phone text)
language sql stable security definer set search_path to '' as $$
  select b.rider_name, b.rider_phone from public.rides r join public.taxi_bookings b on b.ext_id = r.ext_id
  where r.ext_id = p_ext and r.driver = (select auth.uid()) and r.status in ('accepted','arrived','in_progress') $$;
revoke all on function public.rider_contact(text) from public, anon;
grant execute on function public.rider_contact(text) to authenticated;
