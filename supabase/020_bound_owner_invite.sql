-- Invites may be bound to one email. Bound invites redeem only for an account whose email matches AND is confirmed
-- (Google sign-in emails are verified by Google; email sign-ups must click the confirm link first).
alter table public.invites add column if not exists bound_email text check (bound_email is null or bound_email = lower(bound_email));
-- users can never create bound or owner invites from the app (owner invites are operator-seeded only)
drop policy if exists inv_create on public.invites;
create policy inv_create on public.invites for insert to authenticated with check (
  created_by = (select auth.uid()) and used_by is null and bound_email is null and expires_at <= now() + interval '30 days' and (
    (role = 'driver' and (select public.taxi_role()) in ('dispatcher','owner')) or
    (role = 'dispatcher' and ((select public.taxi_role()) = 'owner' or (select public.is_admin())))));
create or replace function public._redeem_invite(p_user uuid, p_code text) returns text language plpgsql security definer set search_path = '' as $$
declare inv public.invites; em text; ok boolean;
begin
  select lower(email), email_confirmed_at is not null into em, ok from auth.users where id = p_user;
  update public.invites set used_by = p_user, used_at = now()
   where code = upper(trim(p_code)) and used_by is null and expires_at > now()
     and (bound_email is null or (bound_email = em and ok)) returning * into inv;
  if not found then
    if exists (select 1 from public.invites where code = upper(trim(p_code)) and used_by is null and expires_at > now() and bound_email is not null) then
      raise exception 'This invite is for a different email address (or the email is not confirmed yet)'; end if;
    raise exception 'Invite code is invalid, expired or already used'; end if;
  update public.profiles set taxi_role = inv.role, role = case when inv.role = 'owner' then 'admin' else role end where id = p_user;
  return inv.role;
end $$;
revoke execute on function public._redeem_invite(uuid, text) from public, anon, authenticated;
-- owner may see who an invite is for; nobody else sees bound_email (check_invite returns role only)
