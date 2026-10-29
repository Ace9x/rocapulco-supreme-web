-- 015: QA test accounts (fake TEST data, no real TLC numbers) skip only the photo / TLC-record / review items of the go-online gate.
-- Real document expiry checks still apply. Remove rows here before launch if you don't want automated tests to go online.
create table if not exists public.taxi_test_accounts (user_id uuid primary key references auth.users(id) on delete cascade, note text);
alter table public.taxi_test_accounts enable row level security; -- no policies: invisible to clients
insert into public.taxi_test_accounts values ('8e5c56d8-f423-4afe-b6ee-45f9719c6d9f', 'QA dispatcher test account') on conflict do nothing;

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
  if not exists (select 1 from public.taxi_test_accounts t where t.user_id = auth.uid()) then
  if d.photo is null then p := array_append(p, 'profile photo missing (riders use it to recognise you)'::text); end if;
  if coalesce((d.tlc_check->>'driver_active')::boolean,false) is false then p := array_append(p, 'TLC driver license not found as active in NYC TLC records (run the TLC check)'::text); end if;
  if coalesce((d.tlc_check->>'vehicle_active')::boolean,false) is false then p := array_append(p, 'FHV vehicle license not found as active in NYC TLC records (run the TLC check)'::text); end if;
  if d.review_status <> 'approved' then p := array_append(p, ('dispatch review: ' || d.review_status)::text); end if;
  end if;
  return query select coalesce(array_length(p,1),0) = 0, p;
end $$;
