-- Inkmagik — Stripe purchases + token crediting
-- Run once in the Supabase dashboard → SQL Editor → New query → Run.
-- Safe to re-run.

-- 1) One row per completed Stripe Checkout. The primary key is Stripe's
--    checkout session id, which gives us idempotency for free: Stripe retries
--    webhook deliveries, and a repeat insert simply conflicts and is skipped
--    instead of crediting the tokens twice.
create table if not exists public.purchases (
  id           text primary key,          -- Stripe checkout session id
  user_id      uuid not null references auth.users(id) on delete cascade,
  tokens       integer not null,
  amount_cents integer,
  currency     text,
  created_at   timestamptz not null default now()
);

create index if not exists purchases_user_idx on public.purchases (user_id, created_at desc);

-- 2) RLS: a user may read their own purchase history; nobody writes from the
--    client (only the server, via the service_role key, inserts here).
alter table public.purchases enable row level security;

drop policy if exists "read own purchases" on public.purchases;
create policy "read own purchases" on public.purchases
  for select using (auth.uid() = user_id);

-- 3) Add tokens to an account. This is the ONLY way tokens are created, and it
--    must never be callable by users — otherwise anyone could top themselves
--    up for free. Only the server (service_role) may execute it.
create or replace function public.credit_tokens(p_user uuid, p_amount integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  if p_amount is null or p_amount <= 0 then
    return null;
  end if;
  update public.profiles
     set tokens = tokens + p_amount
   where id = p_user
   returning tokens into v;
  return v;
end;
$$;

revoke execute on function public.credit_tokens(uuid, integer) from public, anon, authenticated;
grant  execute on function public.credit_tokens(uuid, integer) to service_role;
