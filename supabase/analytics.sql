-- Inkmagik — analytics
-- Run once in the Supabase dashboard → SQL Editor → New query → Run.
-- Safe to re-run.

-- 1) Keep render history forever, even after the image file is pruned.
--    The file costs storage; this row is a few bytes and is the only record
--    that a render ever happened. `pruned = true` means "file deleted, history
--    kept". The gallery only ever shows rows where pruned = false.
alter table public.renders add column if not exists pruned boolean not null default false;
alter table public.renders add column if not exists engine text;

create index if not exists renders_style_idx  on public.renders (style);
create index if not exists renders_pruned_idx on public.renders (user_id, pruned, created_at desc);

-- 2) Event log for the parts of the funnel the other tables can't see —
--    anonymous visitors, people who hit "out of tokens", checkouts that were
--    started but never paid.
--
--    user_id is nullable so we can record anonymous visitors, and is set to
--    null (not deleted) if an account goes away — so the stats survive but
--    stop being personal data.
create table if not exists public.events (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  event      text not null,
  meta       jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_event_created_idx on public.events (event, created_at desc);
create index if not exists events_user_idx          on public.events (user_id, created_at desc);

-- 3) RLS on with NO policies: the browser can neither read nor write this.
--    Only the server (service_role) touches it, so nobody can pollute your
--    analytics or read other people's activity.
alter table public.events enable row level security;
