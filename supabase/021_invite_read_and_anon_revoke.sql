-- Applied 2026-10-29. Invite codes: owner/admin read all; a dispatcher reads only the unbound driver invites it created (needed for insert..returning).
drop policy if exists inv_read on public.invites;
create policy inv_read on public.invites for select to authenticated using (
  (select public.taxi_role()) = 'owner' or (select public.is_admin())
  or (created_by = (select auth.uid()) and role = 'driver' and bound_email is null and (select public.taxi_role()) = 'dispatcher'));
revoke all on public.invites from anon;
-- Functions that never need anonymous callers (triggers, RLS helpers, signed-in RPCs, SQL helpers)
do $$ declare f text; begin
 foreach f in array array['append_only()','create_fleet(text)','create_fleet_invite(uuid,text)','driver_stop_event(uuid,integer,text,double precision,double precision,jsonb,text)','edgepro_touch()','fleet_role(uuid)','is_fleet_staff(uuid)','is_load_party(uuid)','is_load_staff(uuid)','join_fleet(text,text)','load_doc_party(text)','load_doc_staff(text)','load_pin_ok(uuid,text)','lock_driver_booking_cols()','lock_quote()','rides_audit()','rides_guard()','staff_sees_driver(uuid)','tlc_csv_cell(text)','tlc_license_problems(text,text,text,text,text)','tlc_loc_type(text,text)','touch()'] loop
  execute format('grant execute on function public.%s to authenticated, service_role', f);
  execute format('revoke execute on function public.%s from public, anon', f);
 end loop; end $$;
