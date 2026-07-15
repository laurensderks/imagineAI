-- Inkmagik — analytics queries
--
-- These are for YOU to run ad hoc in the Supabase SQL Editor. Copy one and run
-- it; nothing here needs to be "installed".
--
-- Deliberately NOT created as views: a view in the public schema is exposed
-- through the API, and a view over an RLS-protected table can leak everyone's
-- data to any client. Plain queries you run as the owner have no such risk.

-- ===========================================================================
-- USAGE
-- ===========================================================================

-- Renders per day (includes pruned history — that's why we keep the rows)
select date_trunc('day', created_at)::date as day,
       count(*) as renders,
       count(distinct user_id) as users
from public.renders
group by 1 order by 1 desc limit 30;

-- Which styles people actually pick. Tells you what to add, improve, or drop.
select style,
       count(*) as renders,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from public.renders
group by 1 order by renders desc;

-- Fast vs High-Res split — drives your real OpenAI cost and validates the 1:2
-- token pricing. (engine is only recorded for renders after analytics.sql.)
select coalesce(engine, 'unknown') as engine,
       count(*) as renders,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from public.renders
group by 1 order by renders desc;

-- Estimated OpenAI spend, using your MEASURED costs (AUD)
select coalesce(engine, 'fast') as engine,
       count(*) as renders,
       round((count(*) * case when engine = 'quality' then 0.24 else 0.17 end)::numeric, 2) as est_aud
from public.renders
group by 1;

-- How long renders take, per engine (from the render_completed event)
select meta->>'engine' as engine,
       count(*) as n,
       round(avg((meta->>'ms')::numeric)) as avg_ms,
       round(max((meta->>'ms')::numeric)) as slowest_ms
from public.events where event = 'render_completed'
group by 1;

-- ===========================================================================
-- VISITS
-- ===========================================================================
-- page_view is logged server-side (unblockable, no IP, no cookie, but includes
-- bots and can't be tied to a user). app_opened is logged client-side (has the
-- user, but ad blockers stop some of it). Use both — they answer different
-- questions.

-- Real visits per day, bots excluded
select date_trunc('day', created_at)::date as day,
       count(*) filter (where (meta->>'bot')::boolean is false) as humans,
       count(*) filter (where (meta->>'bot')::boolean is true)  as bots,
       count(*) filter (where (meta->>'mobile')::boolean is true
                          and (meta->>'bot')::boolean is false) as mobile
from public.events where event = 'page_view'
group by 1 order by 1 desc limit 30;

-- Where visitors come from (null = typed the URL or came from a private link)
select coalesce(meta->>'referrer', '(direct)') as source, count(*) as visits
from public.events
where event = 'page_view' and (meta->>'bot')::boolean is false
group by 1 order by visits desc limit 20;

-- AD-BLOCK RATE: the gap between the server-side count and the client-side one
-- is roughly how many visitors block your analytics JS.
select
  (select count(*) from public.events
    where event = 'page_view' and (meta->>'bot')::boolean is false) as server_side_visits,
  (select count(*) from public.events where event = 'app_opened')   as client_side_visits,
  round(100.0 * (1 - (select count(*) from public.events where event = 'app_opened')::numeric
        / nullif((select count(*) from public.events
                   where event = 'page_view' and (meta->>'bot')::boolean is false), 0)), 1)
        as est_blocked_pct;

-- ===========================================================================
-- FUNNEL
-- ===========================================================================

-- Top-level funnel. The drop between visitors and signups is your biggest lever.
-- Uses the server-side visit count, since it's the truthful one.
select
  (select count(*) from public.events
    where event = 'page_view' and (meta->>'bot')::boolean is false)    as visits,
  (select count(*) from public.events where event = 'drawing_started')  as drew,
  (select count(*) from public.profiles)                               as signups,
  (select count(*) from public.events where event = 'buy_opened')       as opened_buy,
  (select count(*) from public.events where event = 'checkout_started') as started_checkout,
  (select count(*) from public.events where event = 'checkout_completed') as paid;

-- Checkout abandonment: started but never paid
select
  count(*) filter (where event = 'checkout_started')   as started,
  count(*) filter (where event = 'checkout_completed') as completed,
  round(100.0 * count(*) filter (where event = 'checkout_completed')
        / nullif(count(*) filter (where event = 'checkout_started'), 0), 1) as conversion_pct
from public.events;

-- People who ran out of tokens — your clearest pricing signal. If they hit this
-- and never bought, your price or your pack sizes are wrong.
select date_trunc('day', created_at)::date as day,
       count(*) as hit_paywall,
       count(distinct user_id) as users
from public.events where event = 'out_of_tokens'
group by 1 order by 1 desc;

-- Failed renders (these are free to the user, but cost you goodwill)
select meta->>'engine' as engine, meta->>'error' as error, count(*)
from public.events where event = 'render_failed'
group by 1, 2 order by count desc limit 20;

-- ===========================================================================
-- MONEY
-- ===========================================================================

-- Revenue by day
select date_trunc('day', created_at)::date as day,
       count(*) as purchases,
       sum(amount_cents) / 100.0 as revenue,
       sum(tokens) as tokens_sold
from public.purchases
group by 1 order by 1 desc;

-- Which pack sells best
select tokens as pack, count(*) as sales, sum(amount_cents) / 100.0 as revenue
from public.purchases
group by 1 order by sales desc;

-- Repeat buyers vs one-timers
select case when n = 1 then 'one purchase' else n || ' purchases' end as bucket,
       count(*) as customers
from (select user_id, count(*) as n from public.purchases group by 1) t
group by 1, n order by n;

-- BREAKAGE: tokens sold vs tokens still unspent. Unspent tokens are money you
-- have been paid for work you never had to do — pure margin.
select
  (select coalesce(sum(tokens), 0) from public.purchases) as tokens_sold,
  (select coalesce(sum(tokens), 0) from public.coupons c
     join public.coupon_redemptions r on r.code = c.code) as tokens_gifted,
  (select coalesce(sum(tokens), 0) from public.profiles)  as tokens_unspent;

-- Gift code uptake
select c.code, c.note, c.tokens, c.max_redemptions, c.redemptions, c.expires_at,
       case when c.expires_at < now() then 'expired'
            when c.redemptions >= c.max_redemptions then 'used up'
            else 'active' end as status
from public.coupons c order by c.created_at desc;

-- ===========================================================================
-- RETENTION
-- ===========================================================================

-- Do people come back? Days active per user.
select active_days, count(*) as users from (
  select user_id, count(distinct date_trunc('day', created_at)) as active_days
  from public.renders group by 1
) t group by 1 order by active_days;

-- Signups per day
select date_trunc('day', created_at)::date as day, count(*) as signups
from public.profiles group by 1 order by 1 desc limit 30;
