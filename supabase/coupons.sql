-- Inkmagik — gift/coupon codes
-- Run once in the Supabase dashboard → SQL Editor → New query → Run.
-- Safe to re-run.
--
-- These gift tokens directly (no Stripe, no payment). You generate a code with
-- create_coupon() below, hand it to someone, and they redeem it in the app.

-- 1) The codes themselves.
create table if not exists public.coupons (
  code            text primary key,
  tokens          integer not null check (tokens > 0),
  expires_at      timestamptz,                 -- null = never expires
  max_redemptions integer not null default 1,
  redemptions     integer not null default 0,
  note            text,                        -- e.g. "for Sam"
  created_at      timestamptz not null default now()
);

-- 2) Who has redeemed what. The composite primary key is what stops the same
--    person redeeming the same code twice.
create table if not exists public.coupon_redemptions (
  code        text not null references public.coupons(code) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);

-- 3) RLS with NO policies: clients cannot read or write these tables at all.
--    That matters — if users could SELECT coupons they could just read the
--    codes and gift themselves tokens. Only the function below touches them.
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

-- 4) Redeem a code for the CALLER only (auth.uid()) — never an arbitrary user.
--    Returns jsonb: {ok:true, tokens, balance} or {ok:false, error:"..."}.
create or replace function public.redeem_coupon(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c           record;
  uid         uuid := auth.uid();
  new_balance integer;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  -- `for update` locks the row so two simultaneous redemptions can't both
  -- slip past the max_redemptions check.
  select * into c from public.coupons
   where code = upper(trim(p_code)) for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if c.redemptions >= c.max_redemptions then
    return jsonb_build_object('ok', false, 'error', 'used_up');
  end if;

  begin
    insert into public.coupon_redemptions (code, user_id) values (c.code, uid);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_redeemed');
  end;

  update public.coupons set redemptions = redemptions + 1 where code = c.code;
  update public.profiles set tokens = tokens + c.tokens
   where id = uid returning tokens into new_balance;

  return jsonb_build_object('ok', true, 'tokens', c.tokens, 'balance', new_balance);
end;
$$;

revoke execute on function public.redeem_coupon(text) from public, anon;
grant  execute on function public.redeem_coupon(text) to authenticated;

-- 5) Generate a code. Deliberately NOT callable by any client role — you run
--    this yourself from the SQL Editor:
--
--      select public.create_coupon(20, 30, 1, 'for Sam');
--
--    → tokens=20, expires in 30 days, usable once. Returns e.g. 'INK-3F9A-C21D'.
--    Pass p_days => null for a code that never expires.
create or replace function public.create_coupon(
  p_tokens integer,
  p_days   integer default 30,
  p_max    integer default 1,
  p_note   text default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
  i integer := 0;
begin
  loop
    i := i + 1;
    -- gen_random_uuid() is cryptographically random and built into Postgres,
    -- so this needs no extensions.
    new_code := 'INK-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    begin
      insert into public.coupons (code, tokens, expires_at, max_redemptions, note)
      values (
        new_code,
        p_tokens,
        case when p_days is null then null else now() + make_interval(days => p_days) end,
        p_max,
        p_note
      );
      return new_code;
    exception when unique_violation then
      if i > 5 then raise exception 'could not generate a unique coupon code'; end if;
      -- else: astronomically unlikely collision, try again
    end;
  end loop;
end;
$$;

revoke execute on function public.create_coupon(integer, integer, integer, text)
  from public, anon, authenticated;
