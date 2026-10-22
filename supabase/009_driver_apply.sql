-- 009: public driver applications (no account needed). Applicant holds a private token; dispatch reviews; approval mints a driver invite.
create table if not exists public.taxi_applications (
  id uuid primary key default gen_random_uuid(), token uuid not null default gen_random_uuid(),
  name text, phone text, email text, area text, lang text default 'en',
  has_tlc boolean, tlc_license text, vehicle text, fhv_plate text, wav boolean default false,
  step int not null default 1, status text not null default 'draft' check (status in ('draft','submitted','approved','needs_doc','declined')),
  review_note text, needs text[], invite_code text, reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.taxi_application_docs (
  app_id uuid not null references public.taxi_applications(id) on delete cascade, kind text not null check (kind in ('license','tlc','insurance','registration')),
  photo text not null check (char_length(photo) < 600000), sharpness numeric, blurry boolean, expires date, uploaded_at timestamptz not null default now(), primary key (app_id, kind));
alter table public.taxi_applications enable row level security; alter table public.taxi_application_docs enable row level security;
create policy "dispatch reads applications" on public.taxi_applications for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner'));
create policy "dispatch reads application docs" on public.taxi_application_docs for select to authenticated using ((select public.taxi_role()) in ('dispatcher','owner'));

create or replace function public.apply_save(p_id uuid, p_token uuid, p jsonb) returns table(id uuid, token uuid, status text)
language plpgsql security definer set search_path to '' as $$
declare a public.taxi_applications; ph text := left(regexp_replace(coalesce(p->>'phone',''), '[^0-9+]', '', 'g'), 20);
begin
  if p_id is null then
    if (select count(*) from public.taxi_applications x where x.created_at > now() - interval '1 hour') >= 40 then raise exception 'busy, try again later or call dispatch'; end if;
    if ph <> '' and (select count(*) from public.taxi_applications x where x.phone = ph and x.created_at > now() - interval '1 day') >= 3 then raise exception 'you already applied today — use the same device to continue'; end if;
    insert into public.taxi_applications default values returning * into a;
  else select * into a from public.taxi_applications x where x.id = p_id and x.token = p_token; if a.id is null then raise exception 'application not found'; end if;
    if a.status in ('approved','declined') then raise exception 'application already reviewed'; end if; end if;
  update public.taxi_applications x set
    name = coalesce(left(nullif(trim(p->>'name'),''),80), x.name), phone = coalesce(nullif(ph,''), x.phone), email = coalesce(left(nullif(trim(p->>'email'),''),120), x.email),
    area = coalesce(left(nullif(p->>'area',''),40), x.area), lang = case when p->>'lang' in ('en','es') then p->>'lang' else x.lang end,
    has_tlc = coalesce((p->>'has_tlc')::boolean, x.has_tlc), tlc_license = coalesce(left(nullif(trim(p->>'tlc_license'),''),20), x.tlc_license),
    vehicle = coalesce(left(nullif(trim(p->>'vehicle'),''),80), x.vehicle), fhv_plate = coalesce(left(upper(nullif(trim(p->>'fhv_plate'),'')),12), x.fhv_plate), wav = coalesce((p->>'wav')::boolean, x.wav),
    step = greatest(x.step, least(coalesce((p->>'step')::int, 1), 3)),
    status = case when (p->>'submit')::boolean is true then 'submitted' else x.status end, updated_at = now()
  where x.id = a.id returning * into a;
  if (p->>'submit')::boolean is true and (a.name is null or a.phone is null) then raise exception 'name and phone are required'; end if;
  return query select a.id, a.token, a.status;
end $$;

create or replace function public.apply_doc(p_id uuid, p_token uuid, p_kind text, p_photo text, p_sharpness numeric, p_expires date) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from public.taxi_applications where id = p_id and token = p_token and status in ('draft','submitted','needs_doc')) then raise exception 'application not found'; end if;
  if p_photo !~ '^data:image/(jpeg|png|webp);base64,' then raise exception 'photo must be an image'; end if;
  insert into public.taxi_application_docs (app_id, kind, photo, sharpness, blurry, expires) values (p_id, p_kind, p_photo, p_sharpness, p_sharpness < 60, p_expires)
  on conflict (app_id, kind) do update set photo = excluded.photo, sharpness = excluded.sharpness, blurry = excluded.blurry, expires = excluded.expires, uploaded_at = now();
  update public.taxi_applications set updated_at = now(), needs = array_remove(needs, p_kind) where id = p_id;
end $$;

create or replace function public.apply_get(p_id uuid, p_token uuid) returns table(status text, step int, review_note text, needs text[], invite_code text, name text, phone text, email text, area text, has_tlc boolean, tlc_license text, vehicle text, fhv_plate text, wav boolean, docs jsonb)
language sql stable security definer set search_path to '' as $$
  select a.status, a.step, a.review_note, a.needs, case when a.status = 'approved' then a.invite_code end, a.name, a.phone, a.email, a.area, a.has_tlc, a.tlc_license, a.vehicle, a.fhv_plate, a.wav,
    coalesce((select jsonb_object_agg(d.kind, jsonb_build_object('blurry', d.blurry, 'expires', d.expires, 'uploaded_at', d.uploaded_at)) from public.taxi_application_docs d where d.app_id = a.id), '{}'::jsonb)
  from public.taxi_applications a where a.id = p_id and a.token = p_token $$;

create or replace function public.apply_review(p_id uuid, p_status text, p_note text, p_needs text[]) returns text
language plpgsql security definer set search_path to '' as $$
declare code text;
begin
  if (select public.taxi_role()) not in ('dispatcher','owner') then raise exception 'dispatch only'; end if;
  if p_status not in ('approved','needs_doc','declined') then raise exception 'bad status'; end if;
  if p_status = 'approved' then insert into public.invites (role, note, created_by, expires_at) values ('driver', left('applicant ' || p_id::text, 120), auth.uid(), now() + interval '14 days') returning invites.code into code; end if;
  update public.taxi_applications set status = p_status, review_note = left(p_note, 300), needs = case when p_status = 'needs_doc' then p_needs end,
    invite_code = coalesce(code, invite_code), reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  return code;
end $$;
revoke all on function public.apply_review(uuid,text,text,text[]) from public, anon; grant execute on function public.apply_review(uuid,text,text,text[]) to authenticated;
grant execute on function public.apply_save(uuid,uuid,jsonb), public.apply_doc(uuid,uuid,text,text,numeric,date), public.apply_get(uuid,uuid) to anon, authenticated;
