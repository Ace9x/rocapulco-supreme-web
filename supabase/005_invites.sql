-- Taxi staff roles are granted ONLY by invite. Users can never self-assign driver/dispatcher/admin.
alter table public.profiles add column if not exists taxi_role text not null default 'rider' check (taxi_role in ('rider','driver','dispatcher','owner'));
-- lock role columns: users may only update their own cosmetic columns; profiles are created by the signup trigger only
drop policy if exists profiles_insert on public.profiles;
revoke insert, update on public.profiles from anon, authenticated;
grant update (display_name, username, avatar, mood, truck, points, stats) on public.profiles to authenticated;
create or replace function public.taxi_role() returns text language sql stable security definer set search_path = '' as
$$ select coalesce((select taxi_role from public.profiles where id = (select auth.uid())), 'rider') $$;
revoke execute on function public.taxi_role() from public, anon; grant execute on function public.taxi_role() to authenticated;

create table public.invites (
  code text primary key default upper(encode(extensions.gen_random_bytes(6), 'hex')),
  role text not null check (role in ('driver','dispatcher','owner')),
  created_by uuid references auth.users on delete set null default auth.uid(),
  note text check (char_length(note) <= 120),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users on delete set null, used_at timestamptz,
  created_at timestamptz not null default now());
create index invites_created_by_idx on public.invites (created_by);
create index invites_used_by_idx on public.invites (used_by);
alter table public.invites enable row level security;
-- dispatchers invite drivers; owner/admin invite drivers or dispatchers. Owner invites are seeded by the operator only.
create policy inv_create on public.invites for insert to authenticated with check (
  created_by = (select auth.uid()) and used_by is null and expires_at <= now() + interval '30 days' and (
    (role = 'driver' and (select public.taxi_role()) in ('dispatcher','owner')) or
    (role = 'dispatcher' and ((select public.taxi_role()) = 'owner' or (select public.is_admin())))));
create policy inv_read on public.invites for select to authenticated using (created_by = (select auth.uid()) or (select public.taxi_role()) = 'owner' or (select public.is_admin()));
create policy inv_revoke on public.invites for delete to authenticated using ((created_by = (select auth.uid()) or (select public.taxi_role()) = 'owner') and used_by is null);
grant select, insert, delete on public.invites to authenticated;

-- single redemption path (RPC + signup trigger). Atomic: an invite can be used once, before it expires.
create or replace function public._redeem_invite(p_user uuid, p_code text) returns text language plpgsql security definer set search_path = '' as $$
declare inv public.invites;
begin
  update public.invites set used_by = p_user, used_at = now()
   where code = upper(trim(p_code)) and used_by is null and expires_at > now() returning * into inv;
  if not found then raise exception 'Invite code is invalid, expired or already used'; end if;
  update public.profiles set taxi_role = inv.role, role = case when inv.role = 'owner' then 'admin' else role end where id = p_user;
  return inv.role;
end $$;
revoke execute on function public._redeem_invite(uuid, text) from public, anon, authenticated;
create or replace function public.redeem_invite(p_code text) returns text language plpgsql security definer set search_path = '' as $$
begin if (select auth.uid()) is null then raise exception 'sign in first'; end if; return public._redeem_invite((select auth.uid()), p_code); end $$;
revoke execute on function public.redeem_invite(text) from public, anon; grant execute on function public.redeem_invite(text) to authenticated;
-- anyone may check an invite before signing up (role + validity only)
create or replace function public.check_invite(p_code text) returns text language sql stable security definer set search_path = '' as $$
  select role from public.invites where code = upper(trim(p_code)) and used_by is null and expires_at > now() $$;
grant execute on function public.check_invite(text) to anon, authenticated;

-- signup trigger: role from metadata is IGNORED; an invite code in metadata is redeemed atomically
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          -- RigRoute product roles (trucking): driver or dispatcher; never admin
          case when new.raw_user_meta_data->>'role' in ('driver','dispatcher','rider') then new.raw_user_meta_data->>'role' else 'driver' end)
  on conflict (id) do nothing;
  if coalesce(new.raw_user_meta_data->>'invite', '') <> '' then
    begin perform public._redeem_invite(new.id, new.raw_user_meta_data->>'invite');
    exception when others then null; -- bad code: account stays a rider; app shows the error and lets them retry with redeem_invite
    end;
  end if;
  return new;
end $$;

-- taxi_bookings: staff checks use taxi_role (invite-granted), not the self-chosen RigRoute role
drop policy tb_read on public.taxi_bookings; drop policy tb_dispatch_update on public.taxi_bookings;
create policy tb_read on public.taxi_bookings for select to authenticated using (rider = (select auth.uid()) or assigned_driver = (select auth.uid())
  or (select public.taxi_role()) in ('dispatcher','owner'));
create policy tb_dispatch_update on public.taxi_bookings for update to authenticated using ((select public.taxi_role()) in ('dispatcher','owner'))
  with check ((select public.taxi_role()) in ('dispatcher','owner'));
drop policy rs_read_staff on public.ride_stats;
create policy rs_read_staff on public.ride_stats for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner'));
-- staff directory for dispatch (drivers list)
create or replace function public.taxi_staff() returns table (id uuid, display_name text, taxi_role text) language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.taxi_role from public.profiles p where p.taxi_role in ('driver','dispatcher','owner') and (select public.taxi_role()) in ('dispatcher','owner') $$;
revoke execute on function public.taxi_staff() from public, anon; grant execute on function public.taxi_staff() to authenticated;
