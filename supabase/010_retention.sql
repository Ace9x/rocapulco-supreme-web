-- 010: 6-month retention covers every ride record, not just rides/ride_events. Open complaints (disputes) are kept until resolved.
create or replace function public.purge_old_rides() returns void language sql security definer set search_path to '' as $$
  delete from public.ride_events where at < now() - interval '6 months';
  delete from public.rides where created_at < now() - interval '6 months';
  delete from public.taxi_complaints where created_at < now() - interval '6 months' and status is distinct from 'open';
  delete from public.taxi_bookings b where b.created_at < now() - interval '6 months'
    and not exists (select 1 from public.taxi_complaints c where c.booking_id = b.id or c.ext_id = b.ext_id);
  delete from public.taxi_applications where updated_at < now() - interval '6 months' and status in ('declined','draft'); $$;
revoke all on function public.purge_old_rides() from public, anon, authenticated;
