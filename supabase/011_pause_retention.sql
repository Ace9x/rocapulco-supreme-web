-- 011: retention is PAUSED until Fan confirms the TLC base record-keeping period (audit H2). Nothing is deleted.
-- To resume later: select cron.alter_job((select jobid from cron.job where jobname = 'rocapulco-ride-retention'), active := true);
select cron.alter_job((select jobid from cron.job where jobname = 'rocapulco-ride-retention'), active := false);
-- belt and braces: the function itself is a no-op until re-enabled with the confirmed period
create or replace function public.purge_old_rides() returns void language sql security definer set search_path to '' as $$ select null::void $$;
revoke all on function public.purge_old_rides() from public, anon, authenticated;
