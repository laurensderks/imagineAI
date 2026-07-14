-- ImagineAI — gallery schema (Storage bucket + metadata table)
-- Run once in the Supabase dashboard → SQL Editor → New query → Run.
-- Safe to re-run.

-- 1) Private bucket holding the rendered PNGs. Files live at <user-id>/<uuid>.png
insert into storage.buckets (id, name, public)
values ('renders', 'renders', false)
on conflict (id) do nothing;

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

-- 3) RLS: a user may only see/add/remove their own renders.
alter table public.renders enable row level security;

drop policy if exists "read own renders" on public.renders;
create policy "read own renders" on public.renders
  for select using (auth.uid() = user_id);

drop policy if exists "insert own renders" on public.renders;
create policy "insert own renders" on public.renders
  for insert with check (auth.uid() = user_id);

drop policy if exists "delete own renders" on public.renders;
create policy "delete own renders" on public.renders
  for delete using (auth.uid() = user_id);

-- 4) Storage RLS: a user may only touch files inside their own <user-id>/ folder.
drop policy if exists "read own render files" on storage.objects;
create policy "read own render files" on storage.objects
  for select using (
    bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "insert own render files" on storage.objects;
create policy "insert own render files" on storage.objects
  for insert with check (
    bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "delete own render files" on storage.objects;
create policy "delete own render files" on storage.objects
  for delete using (
    bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text
  );
