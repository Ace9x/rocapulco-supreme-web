-- 012 (applied): RPC hardening from the legal/security audit (M1, M2).
create table if not exists public.lookup_log (caller uuid not null, at timestamptz not null default now());
create index if not exists lookup_log_caller_at on public.lookup_log (caller, at);
alter table public.lookup_log enable row level security; revoke all on public.lookup_log from anon, authenticated;
CREATE OR REPLACE FUNCTION public.apply_review(p_id uuid, p_status text, p_note text, p_needs text[])
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare code text; st text;
begin
  if (select public.taxi_role()) not in ('dispatcher','owner') then raise exception 'dispatch only'; end if;
  if p_status not in ('approved','needs_doc','declined') then raise exception 'bad status'; end if;
  select status into st from public.taxi_applications where id = p_id for update;
  if st is null then raise exception 'application not found'; end if;
  if st not in ('submitted','needs_doc') then raise exception 'application is %, not waiting for review', st; end if;
  if p_status = 'approved' then insert into public.invites (role, note, created_by, expires_at) values ('driver', left('applicant ' || p_id::text, 120), auth.uid(), now() + interval '14 days') returning invites.code into code; end if;
  update public.taxi_applications set status = p_status, review_note = left(p_note, 300), needs = case when p_status = 'needs_doc' then p_needs end,
    invite_code = coalesce(code, invite_code), reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  return code;
end $function$
;

CREATE OR REPLACE FUNCTION public.find_user(p_query text)
 RETURNS TABLE(id uuid, display_name text, username text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q text := lower(trim(coalesce(p_query,'')));
begin
  if (select auth.uid()) is null or q = '' then return; end if;
  if position('@' in q) > 1 then
    if (select count(*) from public.lookup_log l where l.caller = auth.uid() and l.at > now() - interval '1 hour') >= 5 then raise exception 'too many email lookups - try their @username'; end if;
    insert into public.lookup_log (caller) values (auth.uid());
    delete from public.lookup_log l where l.at < now() - interval '1 day';
    return query select p.id, p.display_name, p.username, p.role from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = q and p.id <> auth.uid() limit 1;
  else
    return query select p.id, p.display_name, p.username, p.role from public.profiles p where p.username = q limit 5;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.review_driver(p_user uuid, p_status text, p_note text, p_handle_ok boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select public.taxi_role()) not in ('dispatcher','owner') then raise exception 'dispatch only'; end if;
  if p_user = auth.uid() and (select public.taxi_role()) <> 'owner' then raise exception 'another dispatcher must review your own documents'; end if;
  if p_status not in ('pending','approved','needs_doc','declined') then raise exception 'bad status'; end if;
  update public.taxi_driver_docs set review_status = p_status, review_note = left(p_note,300), handle_verified = coalesce(p_handle_ok, handle_verified) and pay_handle is not null,
    reviewed_by = auth.uid(), reviewed_at = now() where user_id = p_user;
  if not found then raise exception 'driver documents not found'; end if;
end $function$
;
revoke all on function public.find_user(text) from public, anon; grant execute on function public.find_user(text) to authenticated;
revoke all on function public.apply_review(uuid,text,text,text[]) from public, anon; grant execute on function public.apply_review(uuid,text,text,text[]) to authenticated;
revoke all on function public.review_driver(uuid,text,text,boolean) from public, anon; grant execute on function public.review_driver(uuid,text,text,boolean) to authenticated;
revoke all on function public.save_driver_docs(jsonb) from public, anon; grant execute on function public.save_driver_docs(jsonb) to authenticated;
