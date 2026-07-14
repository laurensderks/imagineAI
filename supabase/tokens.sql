-- ImagineAI — token/credits schema
-- Run this once in the Supabase dashboard → SQL Editor → New query → Run.
-- It is safe to re-run (idempotent where it matters).

-- 1) A profile per user, holding their token balance.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  tokens     integer not null default 0,
  created_at timestamptz not null default now()
);

-- 2) Row Level Security: a user may READ only their own profile, and may
--    never write it directly (no insert/update/delete policies exist, so all
--    client writes are denied — tokens can only change via the functions below).
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

-- 3) Auto-create a profile row whenever someone signs up. New users start at
--    0 tokens (they buy some); we seed YOUR account separately below.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, tokens)
  values (new.id, new.email, 0)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- This function is only ever run by the trigger above — nobody should be able
-- to call it directly. Revoking execute does NOT stop the trigger from firing.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 4) The ONLY way tokens get spent: an atomic "spend N" that a signed-in user
--    can call for themselves. It only ever DECREASES the balance, and only if
--    there are enough tokens, so it is safe to expose to the client/server.
--    Returns the new balance, or NULL if there weren't enough tokens.
create or replace function public.spend_tokens(amount integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  -- Guard: only positive spends allowed. Without this, spend_tokens(-100)
  -- would ADD 100 tokens (tokens - (-100)), letting a user top up for free.
  if amount is null or amount <= 0 then
    return null;
  end if;
  update public.profiles
     set tokens = tokens - amount
   where id = auth.uid() and tokens >= amount
   returning tokens into v;
  return v;
end;
$$;

-- Only signed-in users may spend (and only ever their own tokens, via auth.uid()).
-- Anonymous callers have no business here, so drop the default public grant.
revoke execute on function public.spend_tokens(integer) from public, anon;
grant execute on function public.spend_tokens(integer) to authenticated;

-- 5) Backfill: give every existing user a profile row (in case they signed up
--    before this table existed).
insert into public.profiles (id, email, tokens)
select id, email, 0 from auth.users
on conflict (id) do nothing;

-- 6) Seed YOUR account with 10 tokens for testing the spend flow.
update public.profiles set tokens = 10
where email = 'laurens.derks1@gmail.com';
