-- Inkmagik — gallery schema (Storage bucket + metadata table)
-- Run once in the Supabase dashboard → SQL Editor → New query → Run.
-- Safe to re-run.

-- 1) Private bucket holding the rendered PNGs. Files live at <user-id>/<uuid>.png
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('renders', 'renders', false, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- The insert above does nothing if the bucket already exists, so state the
-- settings explicitly too — otherwise a bucket created earlier (possibly as
-- PUBLIC, and with no size or type limits) would silently keep those settings.
-- Storage enforces these itself, which matters because the trace uploads go
-- straight from the browser to Storage without passing through our server.
update storage.buckets
   set public = false,
       file_size_limit = 10485760, -- 10 MB
       allowed_mime_types = array['image/png','image/jpeg','image/webp']
 where id = 'renders';

-- 2) One row per saved render. The image itself is in Storage; this is metadata.
create table if not exists public.renders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  path       text not null,
  style      text,
  created_at timestamptz not null default now()
);

create index if not exists renders_user_created_idx
  on public.renders (user_id, created_at desc);

-- 3) RLS: a user may only see/add/update/remove their own renders.
alter table public.renders enable row level security;

drop policy if exists "read own renders" on public.renders;
create policy "read own renders" on public.renders
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own renders" on public.renders;
create policy "insert own renders" on public.renders
  for insert to authenticated with check (auth.uid() = user_id);

-- The server marks a row `pruned = true` once its file has been deleted (see
-- saveToGallery in server.js). Without this policy that UPDATE matches no rows
-- and silently does nothing, leaving the gallery listing renders whose images
-- are already gone. The WITH CHECK stops a row being reassigned to someone else.
drop policy if exists "update own renders" on public.renders;
create policy "update own renders" on public.renders
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own renders" on public.renders;
create policy "delete own renders" on public.renders
  for delete to authenticated using (auth.uid() = user_id);

-- 4) Storage RLS: a user may only touch files inside their own <user-id>/ folder.
--    Scoped `to authenticated` — signed-out callers have no auth.uid() to match
--    against, so this only makes explicit what was already true.
drop policy if exists "read own render files" on storage.objects;
create policy "read own render files" on storage.objects
  for select to authenticated using (
    bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "insert own render files" on storage.objects;
create policy "insert own render files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No UPDATE policy here on purpose: every render is written once, to a fresh
-- random path, and never overwritten.
drop policy if exists "delete own render files" on storage.objects;
create policy "delete own render files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text
  );
