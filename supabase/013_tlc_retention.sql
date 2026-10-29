-- 013: TLC retention set from the official rule. 35 RCNY 59B-19(b)(2): "Required operational records must be
-- maintained at the Base for a period of 18 months; inspection records must be kept for 12 months."
-- Source: https://www.nyc.gov/assets/tlc/downloads/pdf/rule_book_current_chapter_59.pdf (checked 2026-10-28).
-- We keep trip records 19 months (18 + 1 month safety buffer) and never purge rows tied to an open complaint.
-- Driver documents / inspection data are NOT purged here (12-month minimum; kept while the driver is affiliated).
create or replace function public.purge_old_rides() returns void language sql security definer set search_path to '' as $$
  delete from public.ride_events where at < now() - interval '19 months';
  delete from public.rides where created_at < now() - interval '19 months';
  delete from public.taxi_complaints where created_at < now() - interval '19 months' and status is distinct from 'open';
  delete from public.taxi_bookings b where b.created_at < now() - interval '19 months'
    and not exists (select 1 from public.taxi_complaints c where (c.booking_id = b.id or c.ext_id = b.ext_id) and c.status = 'open');
  delete from public.taxi_applications where updated_at < now() - interval '6 months' and status in ('declined','draft'); $$;
revoke all on function public.purge_old_rides() from public, anon, authenticated;
select cron.alter_job((select jobid from cron.job where jobname = 'rocapulco-ride-retention'), active := true);
