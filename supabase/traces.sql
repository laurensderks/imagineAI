-- Inkmagik — cross-device trace images
-- Run once in the Supabase dashboard → SQL Editor → New query → Run.
-- Safe to re-run.
--
-- Lets a signed-in user place a reference photo on a page on one device and
-- have it load on that page on another. Up to 4 per user (one per page). The
-- image file is deleted when the user finishes tracing; drawing/download stay
-- free and anonymous, so this only ever concerns signed-in users.

-- 1) Private bucket for the reference photos. Files at <user-id>/<page>.jpg —
--    a deterministic path per page, so replacing overwrites and there are never
--    more than 4 files per user.
insert into storage.buckets (id, name, public)
values ('traces', 'traces', false)
on conflict (id) do nothing;

-- 2) One row per (user, page) holding the geometry — where the photo sits, how
--    big, rotation, fade, and whether it's locked. The image itself is in
--    Storage; this is just how to place it.
create table if not exists public.page_traces (
  user_id    uuid not null references auth.users(id) on delete cascade,
  page_index integer not null check (page_index between 0 and 3),
  geometry   jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, page_index)
);

-- 3) RLS: a user may read/write only their OWN trace rows. This is the user's
--    own working data (like a profile), so client CRUD is fine here — unlike
--    tokens/coupons, there's nothing to gain by writing your own trace geometry.
alter table public.page_traces enable row level security;

drop policy if exists "read own traces" on public.page_traces;
create policy "read own traces" on public.page_traces
  for select using (auth.uid() = user_id);

drop policy if exists "insert own traces" on public.page_traces;
create policy "insert own traces" on public.page_traces
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own traces" on public.page_traces;
create policy "update own traces" on public.page_traces
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own traces" on public.page_traces;
create policy "delete own traces" on public.page_traces
  for delete using (auth.uid() = user_id);

-- 4) Storage RLS: a user may only touch files inside their own <user-id>/
--    folder in the traces bucket. select + insert + update + delete, because
--    replacing a page's photo is an upsert (upload with overwrite).
drop policy if exists "read own trace files" on storage.objects;
create policy "read own trace files" on storage.objects
  for select using (
    bucket_id = 'traces' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "insert own trace files" on storage.objects;
create policy "insert own trace files" on storage.objects
  for insert with check (
    bucket_id = 'traces' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "update own trace files" on storage.objects;
create policy "update own trace files" on storage.objects
  for update using (
    bucket_id = 'traces' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "delete own trace files" on storage.objects;
create policy "delete own trace files" on storage.objects
  for delete using (
    bucket_id = 'traces' and (storage.foldername(name))[1] = auth.uid()::text
  );
