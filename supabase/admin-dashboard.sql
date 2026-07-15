-- Inkmagik — admin dashboard data
--
-- RUN THIS LAST. It reads profiles, renders, events, purchases and coupons, so
-- tokens.sql, gallery.sql, purchases.sql, coupons.sql and analytics.sql must all
-- have been run first, or this will fail to create.
--
-- One function returning the whole dashboard as JSON, so the server makes a
-- single call. Not callable by any client role — the server checks that the
-- caller is an admin, then calls this with the service_role key.

create or replace function public.get_analytics()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'generated_at', now(),

    'kpis', jsonb_build_object(
      'visits',         (select count(*) from events
                          where event = 'page_view' and (meta->>'bot')::boolean is false),
      'bots',           (select count(*) from events
                          where event = 'page_view' and (meta->>'bot')::boolean is true),
      'signups',        (select count(*) from profiles),
      'renders',        (select count(*) from renders),
      'failed_renders', (select count(*) from events where event = 'render_failed'),
      'paywall_hits',   (select count(*) from events where event = 'out_of_tokens'),
      'revenue',        (select coalesce(sum(amount_cents), 0) / 100.0 from purchases),
      'tokens_sold',    (select coalesce(sum(tokens), 0) from purchases),
      'tokens_unspent', (select coalesce(sum(tokens), 0) from profiles),
      -- Uses the MEASURED per-render costs (AUD): fast $0.17, high-res $0.24.
      'est_cost_aud',   (select coalesce(round(sum(
                            case when engine = 'quality' then 0.24 else 0.17 end
                          )::numeric, 2), 0) from renders)
    ),

    -- Last 14 days vs the 14 before it, so each tile can show a trend.
    -- Note there is deliberately no delta for unspent tokens: that's a balance
    -- (a stock), not something that happens over a period (a flow), so
    -- "change over 14 days" wouldn't mean anything.
    'deltas', jsonb_build_object(
      'visits', jsonb_build_object(
        'cur',  (select count(*) from events where event = 'page_view'
                  and (meta->>'bot')::boolean is false
                  and created_at >= now() - interval '14 days'),
        'prev', (select count(*) from events where event = 'page_view'
                  and (meta->>'bot')::boolean is false
                  and created_at >= now() - interval '28 days'
                  and created_at <  now() - interval '14 days')),
      'signups', jsonb_build_object(
        'cur',  (select count(*) from profiles where created_at >= now() - interval '14 days'),
        'prev', (select count(*) from profiles where created_at >= now() - interval '28 days'
                  and created_at < now() - interval '14 days')),
      'renders', jsonb_build_object(
        'cur',  (select count(*) from renders where created_at >= now() - interval '14 days'),
        'prev', (select count(*) from renders where created_at >= now() - interval '28 days'
                  and created_at < now() - interval '14 days')),
      'revenue', jsonb_build_object(
        'cur',  (select coalesce(sum(amount_cents), 0) / 100.0 from purchases
                  where created_at >= now() - interval '14 days'),
        'prev', (select coalesce(sum(amount_cents), 0) / 100.0 from purchases
                  where created_at >= now() - interval '28 days'
                  and created_at < now() - interval '14 days')),
      'est_cost_aud', jsonb_build_object(
        'cur',  (select coalesce(round(sum(case when engine = 'quality' then 0.24 else 0.17 end)::numeric, 2), 0)
                  from renders where created_at >= now() - interval '14 days'),
        'prev', (select coalesce(round(sum(case when engine = 'quality' then 0.24 else 0.17 end)::numeric, 2), 0)
                  from renders where created_at >= now() - interval '28 days'
                  and created_at < now() - interval '14 days')),
      'paywall_hits', jsonb_build_object(
        'cur',  (select count(*) from events where event = 'out_of_tokens'
                  and created_at >= now() - interval '14 days'),
        'prev', (select count(*) from events where event = 'out_of_tokens'
                  and created_at >= now() - interval '28 days'
                  and created_at < now() - interval '14 days'))
    ),

    -- Ordered stages: each is a count of people/events reaching that step.
    'funnel', jsonb_build_array(
      jsonb_build_object('label', 'Visited',   'value',
        (select count(*) from events where event = 'page_view' and (meta->>'bot')::boolean is false)),
      jsonb_build_object('label', 'Drew',      'value',
        (select count(*) from events where event = 'drawing_started')),
      jsonb_build_object('label', 'Signed up', 'value',
        (select count(*) from profiles)),
      jsonb_build_object('label', 'Saw packs', 'value',
        (select count(*) from events where event = 'buy_opened')),
      -- Reached Stripe's card page but hasn't paid yet. The drop from here to
      -- "Paid" is your checkout abandonment rate.
      jsonb_build_object('label', 'Went to pay', 'value',
        (select count(*) from events where event = 'checkout_started')),
      jsonb_build_object('label', 'Paid',       'value',
        (select count(*) from events where event = 'checkout_completed'))
    ),

    'styles', coalesce((
      select jsonb_agg(jsonb_build_object('label', style, 'value', n) order by n desc)
      from (select style, count(*) as n from renders group by 1) t
    ), '[]'::jsonb),

    'engines', coalesce((
      select jsonb_agg(jsonb_build_object('label', coalesce(engine, 'unknown'), 'value', n) order by n desc)
      from (select engine, count(*) as n from renders group by 1) t
    ), '[]'::jsonb),

    -- Last 14 days, zero-filled so quiet days show as gaps rather than vanishing.
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('label', to_char(d, 'DD Mon'), 'value', c) order by d)
      from (
        select d,
               (select count(*) from renders r
                 where r.created_at >= d and r.created_at < d + interval '1 day') as c
        from generate_series(
               date_trunc('day', now()) - interval '13 days',
               date_trunc('day', now()),
               interval '1 day') d
      ) t
    ), '[]'::jsonb),

    'recent_purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tokens', tokens,
               'amount', amount_cents / 100.0,
               'at', to_char(created_at, 'DD Mon HH24:MI'))
             order by created_at desc)
      from (select * from purchases order by created_at desc limit 5) t
    ), '[]'::jsonb),

    -- Where visitors come from. '(direct)' = typed the URL, a bookmark, or a
    -- link from somewhere that strips the referrer (most chat apps do).
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('label', src, 'value', n) order by n desc)
      from (
        select coalesce(meta->>'referrer', '(direct)') as src, count(*) as n
        from events
        where event = 'page_view' and (meta->>'bot')::boolean is false
        group by 1 order by n desc limit 8
      ) t
    ), '[]'::jsonb),

    'gift_codes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', code,
               'note', note,
               'tokens', tokens,
               'used', redemptions,
               'max', max_redemptions,
               'status', case
                 when expires_at is not null and expires_at < now() then 'expired'
                 when redemptions >= max_redemptions then 'used up'
                 else 'active' end)
             order by created_at desc)
      from (select * from coupons order by created_at desc limit 8) t
    ), '[]'::jsonb),

    -- Average seconds per render, by engine. If high-res creeps up, that's a
    -- UX problem before it's a cost problem.
    'speed', coalesce((
      select jsonb_agg(jsonb_build_object('label', eng, 'value', secs) order by secs desc)
      from (
        select meta->>'engine' as eng,
               round(avg((meta->>'ms')::numeric) / 1000.0, 1) as secs
        from events
        where event = 'render_completed' and meta->>'ms' is not null
        group by 1
      ) t
    ), '[]'::jsonb),

    'failures', coalesce((
      select jsonb_agg(jsonb_build_object('label', err, 'value', n) order by n desc)
      from (
        select left(coalesce(meta->>'error', 'unknown'), 70) as err, count(*) as n
        from events where event = 'render_failed'
        group by 1 order by n desc limit 5
      ) t
    ), '[]'::jsonb),

    -- Raw counts the dashboard turns into rates (ad-block %, abandonment %).
    'health', jsonb_build_object(
      'server_visits',      (select count(*) from events
                              where event = 'page_view' and (meta->>'bot')::boolean is false),
      'client_visits',      (select count(*) from events where event = 'app_opened'),
      'checkout_started',   (select count(*) from events where event = 'checkout_started'),
      'checkout_completed', (select count(*) from events where event = 'checkout_completed')
    )
  ) into result;

  return result;
end;
$$;

revoke execute on function public.get_analytics() from public, anon, authenticated;
grant  execute on function public.get_analytics() to service_role;
