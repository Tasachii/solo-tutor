\set ON_ERROR_STOP on
-- Public write protection and limiter tables/functions must remain service-only.
do $$
begin
  if has_table_privilege('anon', 'public.public_rate_limits', 'select')
     or has_table_privilege('authenticated', 'public.public_rate_limits', 'select') then
    raise exception 'rate-limit counters are visible to callers';
  end if;
  if has_function_privilege('anon',
      'public.take_public_rate_limit(text,text,integer,integer,integer)', 'execute')
     or has_function_privilege('authenticated',
      'public.take_public_rate_limit(text,text,integer,integer,integer)', 'execute') then
    raise exception 'public caller can bypass the edge and consume limiter RPC directly';
  end if;
  if has_function_privilege('authenticated', 'public.cleanup_public_rate_limits()', 'execute') then
    raise exception 'authenticated caller can delete limiter state';
  end if;
end $$;

set role service_role;
do $$
declare r record;
begin
  select * into r from public.take_public_rate_limit(
    'waitlist', repeat('a', 64), 2, 10, 600);
  if not r.allowed then raise exception 'first client request was limited'; end if;
  select * into r from public.take_public_rate_limit(
    'waitlist', repeat('a', 64), 2, 10, 600);
  if not r.allowed then raise exception 'second client request was limited'; end if;
  select * into r from public.take_public_rate_limit(
    'waitlist', repeat('a', 64), 2, 10, 600);
  if r.allowed or r.retry_after < 1 or r.retry_after > 600 then
    raise exception 'client limit or retry-after is incorrect';
  end if;
  select * into r from public.take_public_rate_limit(
    'delete-account', repeat('b', 64), 5, 200, 600);
  if not r.allowed then raise exception 'account-deletion limiter endpoint was refused'; end if;
end $$;
reset role;

-- ทำให้เก่าเฉพาะแถวของปลายทางที่ไฟล์นี้สร้างเอง แถวของไฟล์อื่นยังใหม่จึงไม่ถูกลบ
-- เดิมทำให้ทั้งตารางเก่าแล้วนับผลรวมแบบตายตัว ซึ่งพังทันทีที่มีปลายทางใหม่เพิ่มเข้ามา
update public.public_rate_limits set window_started = now() - interval '3 hours'
where endpoint in ('waitlist', 'report-error', 'usage', 'delete-account');
set role service_role;
do $$
begin
  if public.cleanup_public_rate_limits() <> 4 then
    raise exception 'service cleanup did not delete all expired client/global rows';
  end if;
end $$;
reset role;

-- Rotating client hashes after the global cap must not grow the limiter table.
set role service_role;
do $$
declare r record; v_allowed integer := 0; v_denied integer := 0;
begin
  for i in 1..50 loop
    select * into r from public.take_public_rate_limit(
      'usage', lpad(to_hex(i), 64, '0'), 1, 2, 600);
    if r.allowed then v_allowed := v_allowed + 1; else v_denied := v_denied + 1; end if;
  end loop;
  if v_allowed <> 2 or v_denied <> 48 then
    raise exception 'global cap decision is incorrect: allowed %, denied %', v_allowed, v_denied;
  end if;
  if (select count(*) from public.public_rate_limits where endpoint = 'usage') <> 3 then
    raise exception 'rotating hashes grew limiter rows after global denial';
  end if;
end $$;
reset role;

do $$
begin
  if has_table_privilege('authenticated', 'public.plan_receipt_counters', 'select') then
    raise exception 'receipt counters are visible to teachers';
  end if;
  if has_table_privilege('authenticated', 'public.revenue_monthly', 'select')
     or has_table_privilege('authenticated', 'public.monthly_plan_month2_renewal', 'select') then
    raise exception 'revenue metrics are visible to teachers';
  end if;
end $$;

-- Revenue views use approved receipts. Month-2 renewal excludes prepaid plans
-- and cohorts whose second calendar month has not finished yet.
insert into public.plan_requests(
  provider_id, months, amount, status, created_at, decided_at, receipt_no
) values
  ('20000000-0000-0000-0000-000000000002', 1, 299, 'approved',
   now() - interval '3 months', now() - interval '3 months', 'SP-200001-9001'),
  ('20000000-0000-0000-0000-000000000002', 1, 299, 'approved',
   now() - interval '2 months', now() - interval '2 months', 'SP-200002-9001');
do $$
declare v_cohort date := date_trunc('month', (now() - interval '3 months') at time zone 'Asia/Bangkok')::date;
begin
  if not exists (select 1 from public.revenue_monthly where gross_baht > 0 and payments > 0) then
    raise exception 'approved receipt revenue was not summarized';
  end if;
  if not exists (select 1 from public.monthly_plan_month2_renewal
      where cohort_month = v_cohort and first_month_payers = 1
        and renewed_in_month_2 = 1 and renewal_percent = 100.0) then
    raise exception 'month-2 paid renewal cohort is incorrect';
  end if;
end $$;

-- Receipt sequences above four digits must expand, not be truncated by lpad.
update public.plan_receipt_counters set last_value = 9999
where receipt_month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
insert into public.plan_requests(provider_id, months, amount)
values ('10000000-0000-0000-0000-000000000001', 1, 299);
set role service_role;
do $$
declare r record;
begin
  select * into r from public.approve_plan_request(
    (select id from public.plan_requests
     where provider_id = '10000000-0000-0000-0000-000000000001' and status = 'pending')
  );
  if r.receipt_no !~ '^SP-[0-9]{6}-10000$' then
    raise exception 'five-digit receipt sequence was truncated: %', r.receipt_no;
  end if;
end $$;
reset role;

-- Provider-linked usage remains private and is nullable for anonymous traffic.
insert into public.usage_events(teacher_id, event, count, provider_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'app_open', 1, null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'app_open', 1,
   '10000000-0000-0000-0000-000000000001');
do $$
begin
  if (select count(*) from public.usage_events where provider_id is null
        and teacher_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1
     or (select count(*) from public.usage_events where provider_id =
       '10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'usage provider attribution did not preserve anonymous and verified rows';
  end if;
  if has_table_privilege('authenticated', 'public.usage_events', 'select') then
    raise exception 'usage rows are visible to authenticated callers';
  end if;
end $$;
