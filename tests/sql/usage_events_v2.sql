\set ON_ERROR_STOP on
-- Runs after every other suite, so each assertion is scoped to its own fixture rows and to a
-- day no other suite writes to. Global counts here would only measure test ordering.

-- 1. The v1 rows survived and were given a v2 identity without inventing anything.
-- Needs tests/sql/pre_usage_events_v2.sql to have run immediately BEFORE 0012_usage_events_v2.sql.
-- The two files are a pair: wire in both or neither.
do $$
declare migrated integer;
begin
  select count(*) into migrated from public.usage_events
  where teacher_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
  if migrated = 0 then
    raise exception 'tests/sql/pre_usage_events_v2.sql did not run before 0012 — wire it into the runner''s pre-migration hook';
  end if;
  if migrated <> 3 then
    raise exception 'migration lost v1 rows (% of 3 remain)', migrated;
  end if;
  if (select count(distinct event_id) from public.usage_events
      where teacher_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')) <> 3 then
    raise exception 'migrated rows did not each get their own event id';
  end if;
  if exists (select 1 from public.usage_events
             where teacher_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
               and (version <> 1 or audience <> 'public' or session_id is not null or route is not null)) then
    raise exception 'migration claimed a version, session, route or audience the v1 rows never had';
  end if;
  if not exists (select 1 from public.usage_events
                 where teacher_id = '11111111-1111-4111-8111-111111111111'
                   and event = 'invoice_issued' and count = 3 and mode = 'real'
                   and at < now() - interval '1 day') then
    raise exception 'migration changed the value of a migrated row';
  end if;
end $$;

-- 2. The same event id can never produce a second row, however often a client retries.
insert into public.usage_events(event_id, teacher_id, session_id, event, count, mode, route, audience, version)
values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444', 'landing_view', 1, null, 'landing', 'public', 2);
do $$
begin
  begin
    insert into public.usage_events(event_id, teacher_id, session_id, event, count, mode, route, audience, version)
    values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333',
            '44444444-4444-4444-8444-444444444444', 'landing_view', 1, null, 'landing', 'public', 2);
    raise exception 'a retried event id was stored twice';
  exception when unique_violation then null;
  end;
end $$;

-- 3. Only agreed names, route categories and audiences are storable at all.
do $$
declare bad text;
begin
  foreach bad in array array['heartbeat', 'pro_requested', 'subscription_payment_verified', 'refund_verified'] loop
    begin
      insert into public.usage_events(event_id, teacher_id, event, count, audience, version)
      values ('bad-' || bad, '33333333-3333-4333-8333-333333333333', bad, 1, 'public', 2);
      raise exception 'event name % was accepted', bad;
    exception when check_violation then null;
    end;
  end loop;
  begin
    insert into public.usage_events(event_id, teacher_id, event, count, route, audience, version)
    values ('bad-route', '33333333-3333-4333-8333-333333333333', 'landing_view', 1,
            '/document/secret-token', 'public', 2);
    raise exception 'a real path was accepted as a route category';
  exception when check_violation then null;
  end;
  begin
    insert into public.usage_events(event_id, teacher_id, event, count, audience, version)
    values ('bad-audience', '33333333-3333-4333-8333-333333333333', 'landing_view', 1, 'investors', 2);
    raise exception 'an unknown audience was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 4. One visit three days ago: Landing, Pricing, Landing, then the demo loop. A team member
-- rehearsing the pitch on the same day must stay off the same numbers.
insert into public.usage_events(event_id, teacher_id, session_id, event, count, mode, route, audience, version, at) values
  ('55555555-0001-4111-8111-555555555555', '55555555-5555-4555-8555-555555555555',
   '66666666-6666-4666-8666-666666666666', 'landing_view', 1, null, 'landing', 'public', 2, now() - interval '3 days'),
  ('55555555-0002-4111-8111-555555555555', '55555555-5555-4555-8555-555555555555',
   '66666666-6666-4666-8666-666666666666', 'pricing_view', 1, null, 'pricing', 'public', 2, now() - interval '3 days'),
  ('55555555-0003-4111-8111-555555555555', '55555555-5555-4555-8555-555555555555',
   '66666666-6666-4666-8666-666666666666', 'landing_view', 1, null, 'landing', 'public', 2, now() - interval '3 days'),
  ('55555555-0004-4111-8111-555555555555', '55555555-5555-4555-8555-555555555555',
   '66666666-6666-4666-8666-666666666666', 'demo_started', 1, 'demo', 'start', 'public', 2, now() - interval '3 days'),
  ('55555555-0005-4111-8111-555555555555', '55555555-5555-4555-8555-555555555555',
   '66666666-6666-4666-8666-666666666666', 'demo_completed', 1, 'demo', null, 'public', 2, now() - interval '3 days'),
  ('77777777-0001-4111-8111-777777777777', '77777777-7777-4777-8777-777777777777',
   '88888888-8888-4888-8888-888888888888', 'landing_view', 1, null, 'landing', 'team', 2, now() - interval '3 days'),
  ('77777777-0002-4111-8111-777777777777', '77777777-7777-4777-8777-777777777777',
   '88888888-8888-4888-8888-888888888888', 'demo_completed', 1, 'demo', null, 'team', 2, now() - interval '3 days');

set role service_role;
do $$
declare r record;
declare visit_day date := ((now() - interval '3 days') at time zone 'Asia/Bangkok')::date;
begin
  select * into r from public.usage_funnel_daily
  where day = visit_day and audience = 'public' and mode is null;
  -- สามการเปิดหน้าในการใช้งานเดียว: Landing สองครั้ง Pricing หนึ่งครั้ง
  if not found or r.landing_views <> 2 or r.pricing_views <> 1
     or r.landing_views + r.pricing_views <> 3 then
    raise exception 'a Landing/Pricing/Landing visit did not read as three page views';
  end if;
  if r.sessions <> 1 or r.visitors <> 1 then
    raise exception 'one visit was counted as more than one session or visitor';
  end if;

  select * into r from public.usage_funnel_daily
  where day = visit_day and audience = 'public' and mode = 'demo';
  if not found or r.demo_started <> 1 or r.demo_completed <> 1 then
    raise exception 'the demo funnel did not record the demo run';
  end if;
  if r.invoices_issued <> 0 or r.payments_recorded <> 0 then
    raise exception 'a demo run was counted as product usage or revenue';
  end if;

  select * into r from public.usage_funnel_daily
  where day = visit_day and audience = 'team' and mode = 'demo';
  if not found or r.demo_completed <> 1 then
    raise exception 'team traffic lost its own axis instead of staying filterable';
  end if;

  -- Real product usage from the migrated rows stays on its own day and its own axis.
  select * into r from public.usage_funnel_daily
  where day = ((now() - interval '2 days') at time zone 'Asia/Bangkok')::date
    and audience = 'public' and mode = 'real';
  if not found or r.invoices_issued <> 3 or r.opened_app <> 1 then
    raise exception 'real-mode product usage disappeared from the funnel';
  end if;

  -- A period with no events has no row at all, so a reader shows "no data" instead of a guess.
  if exists (select 1 from public.usage_funnel_daily
             where day = ((now() - interval '900 days') at time zone 'Asia/Bangkok')::date) then
    raise exception 'an empty period produced an invented row';
  end if;
end $$;
reset role;

-- 5. Money never comes from a browser event. These figures read the server tables.
-- Earlier suites roll their evidence back, so this section makes its own and undoes it.
begin;
insert into auth.users(id) values ('b0000000-0000-4000-8000-00000000000b');
insert into public.plan_requests(provider_id, months, amount)
values ('b0000000-0000-4000-8000-00000000000b', 1, 299);
set role service_role;
select public.approve_plan_request_verified(
  (select id from public.plan_requests where provider_id = 'b0000000-0000-4000-8000-00000000000b'),
  'BANK-ANALYTICS-FUNNEL-1', 299, now(), 'analytics-contract-test');
do $$
declare requested bigint; payments bigint; refunds bigint;
begin
  select coalesce(sum(pro_requested), 0), coalesce(sum(subscription_payment_verified), 0),
         coalesce(sum(refund_verified), 0)
    into requested, payments, refunds from public.plan_funnel_monthly;
  if requested <> (select count(*) from public.plan_requests) then
    raise exception 'plan requests in the funnel do not match the plan_requests table';
  end if;
  if payments <> (select count(*) from public.plan_financial_evidence where evidence_type = 'payment') then
    raise exception 'verified payments in the funnel do not match the bank evidence table';
  end if;
  if refunds <> (select count(*) from public.plan_financial_evidence where evidence_type = 'refund') then
    raise exception 'verified refunds in the funnel do not match the bank evidence table';
  end if;
  if requested < 1 or payments < 1 then
    raise exception 'the revenue funnel was proved against empty tables';
  end if;
  -- A browser can never add to these figures: the names are not storable as events at all.
  if exists (select 1 from public.usage_events
             where event in ('pro_requested', 'subscription_payment_verified', 'refund_verified')) then
    raise exception 'a financial milestone was stored as a browser event';
  end if;
end $$;
reset role;
rollback;

-- 6. Analytics is owner-only on the server, not a hidden menu in the browser.
do $$
begin
  if has_table_privilege('anon', 'public.usage_events', 'select')
     or has_table_privilege('authenticated', 'public.usage_events', 'select')
     or has_table_privilege('authenticated', 'public.usage_events', 'insert') then
    raise exception 'a teacher or visitor can read or write the analytics table directly';
  end if;
  if has_table_privilege('authenticated', 'public.usage_daily', 'select')
     or has_table_privilege('authenticated', 'public.usage_funnel_daily', 'select')
     or has_table_privilege('authenticated', 'public.plan_funnel_monthly', 'select')
     or has_table_privilege('anon', 'public.usage_funnel_daily', 'select')
     or has_table_privilege('anon', 'public.plan_funnel_monthly', 'select') then
    raise exception 'an ordinary teacher can read the owner analytics views';
  end if;
end $$;

-- 7. Deletion for this table stays with the one retention job that publishes its window.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'purge_usage_events') then
    raise exception 'a second retention deleter for the counter table exists';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'apply_retention'
                   and pg_get_functiondef(p.oid) like '%public.usage_events%') then
    raise exception 'the retention job no longer covers the counter table';
  end if;
end $$;
