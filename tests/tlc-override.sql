-- Server test for 019 (run in the SQL editor; it always rolls back). Expect: dispatcher refused, short reason refused,
-- unmatched driver refused, override lets them accept, log is append-only, expired TLC license and bad license still refused.
do $$ declare u uuid; m text := ''; begin
select user_id into u from public.taxi_driver_docs limit 1;
perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
update public.profiles set taxi_role='dispatcher' where id=u;
begin perform public.set_tlc_override(u,'dispatcher tries this'); m:=m||'FAIL dispatcher allowed; '; exception when others then m:=m||'ok dispatcher: '||sqlerrm||'; '; end;
update public.profiles set taxi_role='owner' where id=u;
begin perform public.set_tlc_override(u,'short'); m:=m||'FAIL short reason; '; exception when others then m:=m||'ok reason: '||sqlerrm||'; '; end;
update public.taxi_driver_docs set review_status='approved', tlc_driver_license='5123456', tlc_vehicle_license='T654321C', plate='T654321C', tlc_exp=current_date+100, wav=false, tlc_check=null where user_id=u;
delete from public.taxi_test_accounts where user_id=u; update public.profiles set taxi_role='driver' where id=u;
insert into public.taxi_bookings (ext_id, pickup_address, dropoff_address, est_miles, est_minutes) values ('TEST-ovr-1','1 A St, Queens','2 B St, Queens',2,10);
begin perform public.ride_event('TEST-ovr-1','accept','{}'); m:=m||'FAIL unmatched accepted; '; exception when others then m:=m||'ok unmatched: '||sqlerrm||'; '; end;
update public.profiles set taxi_role='owner' where id=u; perform public.set_tlc_override(u,'TLC open data lags new licenses; card seen in person', now()+interval '7 days');
begin update public.taxi_tlc_override_log set reason='x'; m:=m||'FAIL log edited; '; exception when others then m:=m||'ok log: '||sqlerrm||'; '; end;
update public.profiles set taxi_role='driver' where id=u;
begin perform public.ride_event('TEST-ovr-1','accept','{}'); m:=m||'ok override accept; '; exception when others then m:=m||'FAIL override: '||sqlerrm||'; '; end;
update public.taxi_driver_docs set tlc_exp=current_date-1 where user_id=u;
begin perform public.ride_event('TEST-ovr-1','accept','{}'); m:=m||'FAIL expired accepted; '; exception when others then m:=m||'ok expired: '||sqlerrm||'; '; end;
update public.taxi_driver_docs set tlc_exp=current_date+100, tlc_driver_license='' where user_id=u;
begin perform public.ride_event('TEST-ovr-1','accept','{}'); m:=m||'FAIL bad license accepted; '; exception when others then m:=m||'ok bad license: '||sqlerrm||'; '; end;
update public.profiles set taxi_role='owner' where id=u; perform public.revoke_tlc_override(u,'record now matches');
m:=m||'active after revoke='||public.tlc_override_active(u);
raise exception 'ROLLBACK %', m; end $$;
