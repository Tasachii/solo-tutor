-- P09/J-12 · สัญญาของแดชบอร์ดเจ้าของ
-- ถ้าไฟล์นี้ล้ม แปลว่าอย่างใดอย่างหนึ่งต่อไปนี้จริง แล้วห้ามปล่อยขึ้นระบบ
--   · ครูทั่วไปอ่านตัวเลขทั้งบริษัทได้
--   · เบราว์เซอร์ขยับยอดเงินได้
--   · ช่วงที่ไม่มีข้อมูลตอบเป็นค่าว่างหรือ null แทนที่จะเป็น 0
--   · แหล่งที่มาที่ไม่อยู่ในรายการถูกเก็บไว้ตามที่ส่งมา
--
-- ทั้งไฟล์อยู่ในธุรกรรมเดียวและ rollback ปิดท้าย — ไม่ทิ้งบัญชีเจ้าของหรือแถวทดสอบไว้ในฐาน
-- ช่วงเวลาที่ใช้คือ 210–200 วันก่อน ซึ่งไม่มีชุดทดสอบอื่นเขียนถึง ตัวเลขที่ยืนยันจึงเป็นของไฟล์นี้เอง
\set ON_ERROR_STOP on
begin;

create temporary table owner_probe(name text primary key, value jsonb);
-- เจ้าของเรียกฟังก์ชันในบทบาท authenticated จริง ๆ จึงต้องเขียนตารางพักผลลัพธ์นี้ได้
grant insert, select on owner_probe to authenticated;

do $$
declare
  v_owner constant uuid := 'a1000000-0000-4000-8000-0000000000a1';
  v_teacher constant uuid := 'a1000000-0000-4000-8000-0000000000a2';
  v_activated constant uuid := 'a1000000-0000-4000-8000-0000000000a3';
  v_visitor constant uuid := 'a1000000-0000-4000-8000-0000000000b1';
  v_session constant uuid := 'a1000000-0000-4000-8000-0000000000c1';
  v_day constant date := public.thai_today() - 205;
  v_at constant timestamptz := (v_day::timestamp at time zone 'Asia/Bangkok') + interval '10 hours';
begin
  insert into auth.users(id) values (v_owner), (v_teacher), (v_activated);

  -- ผู้เยี่ยมชมหนึ่งคน: เปิด Landing สองครั้ง Pricing หนึ่งครั้ง แล้วลอง Demo จนจบ — มาจากกลุ่ม LINE
  insert into public.usage_events
    (event_id, teacher_id, session_id, event, count, mode, route, audience, campaign, version, at) values
    ('own-0001', v_visitor, v_session, 'landing_view', 1, null, 'landing', 'public', 'line', 2, v_at),
    ('own-0002', v_visitor, v_session, 'pricing_view', 1, null, 'pricing', 'public', 'line', 2, v_at),
    ('own-0003', v_visitor, v_session, 'landing_view', 1, null, 'landing', 'public', 'line', 2, v_at),
    ('own-0004', v_visitor, v_session, 'demo_started', 1, 'demo', 'start', 'public', 'line', 2, v_at),
    ('own-0005', v_visitor, v_session, 'demo_completed', 1, 'demo', null, 'public', 'line', 2, v_at),
    -- ผู้เยี่ยมชมอีกคนมาจาก QR ที่พิมพ์แจก และกดเริ่มสมัคร
    ('own-0006', 'a1000000-0000-4000-8000-0000000000b2', 'a1000000-0000-4000-8000-0000000000c2',
     'landing_view', 1, null, 'landing', 'public', 'qr', 2, v_at),
    ('own-0007', 'a1000000-0000-4000-8000-0000000000b2', 'a1000000-0000-4000-8000-0000000000c2',
     'signup_started', 1, null, 'start', 'public', 'qr', 2, v_at),
    -- ทีมซ้อมพิทช์วันเดียวกัน ต้องไม่ปนกับตัวเลขสาธารณะ
    ('own-0008', 'a1000000-0000-4000-8000-0000000000b3', 'a1000000-0000-4000-8000-0000000000c3',
     'landing_view', 1, null, 'landing', 'team', 'pitch', 2, v_at),
    ('own-0009', 'a1000000-0000-4000-8000-0000000000b3', 'a1000000-0000-4000-8000-0000000000c3',
     'demo_completed', 1, 'demo', null, 'team', 'pitch', 2, v_at);

  -- ครูที่ออกบิลจริงใบแรกในช่วงนี้ และกลับมาเปิดแอปสองวัน = activated 1 · returning 1
  insert into public.usage_events
    (event_id, teacher_id, session_id, provider_id, event, count, mode, route, audience, version, at) values
    ('own-0010', 'a1000000-0000-4000-8000-0000000000b4', 'a1000000-0000-4000-8000-0000000000c4',
     v_activated, 'invoice_issued', 2, 'real', null, 'public', 2, v_at),
    ('own-0011', 'a1000000-0000-4000-8000-0000000000b4', 'a1000000-0000-4000-8000-0000000000c4',
     v_activated, 'app_open', 1, 'real', 'app', 'public', 2, v_at),
    ('own-0012', 'a1000000-0000-4000-8000-0000000000b4', 'a1000000-0000-4000-8000-0000000000c5',
     v_activated, 'app_open', 1, 'real', 'app', 'public', 2, v_at + interval '1 day'),
    -- ครูอีกคนออกบิลใบแรกไปนานแล้ว การออกบิลอีกใบในช่วงนี้จึงไม่ใช่ "เพิ่งเริ่มใช้"
    ('own-0013', 'a1000000-0000-4000-8000-0000000000b5', 'a1000000-0000-4000-8000-0000000000c6',
     v_teacher, 'invoice_issued', 1, 'real', null, 'public', 2, v_at - interval '120 days'),
    ('own-0014', 'a1000000-0000-4000-8000-0000000000b5', 'a1000000-0000-4000-8000-0000000000c7',
     v_teacher, 'invoice_issued', 1, 'real', null, 'public', 2, v_at),
    ('own-0015', 'a1000000-0000-4000-8000-0000000000b5', 'a1000000-0000-4000-8000-0000000000c7',
     v_teacher, 'app_open', 1, 'real', 'app', 'public', 2, v_at);

  insert into public.analytics_owners(provider_id, note) values (v_owner, 'contract test owner');
end $$;

-- 1. รายชื่อผู้มีสิทธิ์อยู่ฝั่งเซิร์ฟเวอร์: anon เรียกไม่ได้เลย ส่วน authenticated เรียกได้แต่ต้องผ่านด่านในตัวฟังก์ชัน
do $$
begin
  if has_function_privilege('anon',
       'public.owner_analytics(date, date, text, text, text)', 'execute') then
    raise exception 'anon can execute the owner analytics function';
  end if;
  if not has_function_privilege('authenticated',
       'public.owner_analytics(date, date, text, text, text)', 'execute') then
    raise exception 'the owner cannot reach the function through an ordinary logged-in session';
  end if;
  if has_table_privilege('authenticated', 'public.analytics_owners', 'select')
     or has_table_privilege('authenticated', 'public.analytics_owners', 'insert')
     or has_table_privilege('anon', 'public.analytics_owners', 'select') then
    raise exception 'a teacher can read or write the owner list';
  end if;
end $$;

-- 2. ครูที่ล็อกอินอยู่จริง แต่ไม่ได้อยู่ในรายชื่อ ต้องถูกฐานข้อมูลปฏิเสธ ไม่ใช่แค่ไม่เห็นเมนู
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-0000000000a2', true);
do $$
begin
  perform public.owner_analytics(public.thai_today() - 210, public.thai_today() - 200);
  raise exception 'a teacher who is not an owner read the whole dashboard';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  insert into public.analytics_owners(provider_id) values ('a1000000-0000-4000-8000-0000000000a2');
  raise exception 'a teacher added themselves to the owner list';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  if public.is_analytics_owner() then
    raise exception 'a teacher was reported as an owner';
  end if;
end $$;

-- 3. เจ้าของเรียกได้ และได้ตัวเลขของช่วงที่ขอ
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-0000000000a1', true);
do $$
begin
  if not public.is_analytics_owner() then
    raise exception 'the owner account was not recognised';
  end if;
end $$;
insert into owner_probe(name, value)
select 'public', public.owner_analytics(public.thai_today() - 210, public.thai_today() - 200);
insert into owner_probe(name, value)
select 'team', public.owner_analytics(public.thai_today() - 210, public.thai_today() - 200, 'team');
insert into owner_probe(name, value)
select 'qr', public.owner_analytics(public.thai_today() - 210, public.thai_today() - 200, 'public', null, 'qr');
insert into owner_probe(name, value)
select 'line', public.owner_analytics(public.thai_today() - 210, public.thai_today() - 200, 'public', null, 'line');
insert into owner_probe(name, value)
select 'empty', public.owner_analytics(date '2000-01-01', date '2000-01-31');
reset role;

do $$
declare
  v jsonb := (select value from owner_probe where name = 'public');
  v_line jsonb := (select value from owner_probe where name = 'line');
begin
  -- ทุกเบราว์เซอร์ที่ทำอะไรสักอย่างในช่วงนี้: ผู้สนใจสองคนและครูสองคน · ทีมอยู่คนละแกนจึงไม่นับ
  if (v #>> '{traffic,visitors}')::int <> 4 or (v #>> '{traffic,sessions}')::int <> 5 then
    raise exception 'visitor or session counting drifted (%)', v #> '{traffic}';
  end if;
  if (v #>> '{traffic,landing_views}')::int <> 3 or (v #>> '{traffic,pricing_views}')::int <> 1 then
    raise exception 'page views are not counted as page opens (%)', v #> '{traffic}';
  end if;
  -- Acceptance ข้อ 6.6: Landing → Pricing → Landing ในการใช้งานเดียว = 3 views, 1 session, 1 visitor
  if (v_line #>> '{traffic,landing_views}')::int <> 2 or (v_line #>> '{traffic,pricing_views}')::int <> 1
     or (v_line #>> '{traffic,sessions}')::int <> 1 or (v_line #>> '{traffic,visitors}')::int <> 1 then
    raise exception 'one visit of three page opens did not read as one session (%)', v_line #> '{traffic}';
  end if;
  if (v #>> '{demo,started}')::int <> 1 or (v #>> '{demo,completed}')::int <> 1 then
    raise exception 'the demo funnel lost the public demo run';
  end if;
  if (v #>> '{accounts,signup_started}')::int <> 1 then
    raise exception 'a started signup was not counted';
  end if;
  -- ครูที่ออกบิลใบแรกในช่วงนี้มีคนเดียว อีกคนออกใบแรกไปตั้งแต่ 120 วันก่อนช่วงนี้
  if (v #>> '{teachers,activated}')::int <> 1 then
    raise exception 'first-invoice activation counted a teacher who started earlier (%)', v #> '{teachers}';
  end if;
  if (v #>> '{teachers,returning}')::int <> 1 then
    raise exception 'returning teachers must be those who opened the app on two separate days (%)', v #> '{teachers}';
  end if;
  if (v #>> '{teachers,opened_app}')::int <> 2 then
    raise exception 'app opens are counted per browser, not per event (%)', v #> '{teachers}';
  end if;
  -- ทีมซ้อมพิทช์อยู่คนละแกน ตัวเลขสาธารณะจึงไม่มีของทีมปน
  if v #>> '{campaigns}' like '%pitch%' then
    raise exception 'team traffic leaked into the public audience';
  end if;
end $$;

-- 4. แกนทีม/QA ยังดูได้ แต่ต้องขอด้วยตัวกรอง ไม่ใช่ปนมากับตัวเลขสาธารณะ
do $$
declare v jsonb := (select value from owner_probe where name = 'team');
begin
  if (v #>> '{demo,completed}')::int <> 1 or (v #>> '{traffic,visitors}')::int <> 1 then
    raise exception 'team traffic is not readable on its own axis (%)', v;
  end if;
end $$;

-- 5. แหล่งที่มา: แจกแจงได้ และกรองได้ · ค่าที่ไม่อยู่ในรายการเก็บไม่ได้เลยตั้งแต่ชั้นตาราง
do $$
declare
  v jsonb := (select value from owner_probe where name = 'public');
  v_qr jsonb := (select value from owner_probe where name = 'qr');
  v_line int;
begin
  select (row_value #>> '{visitors}')::int into v_line
  from jsonb_array_elements(v #> '{campaigns}') as t(row_value)
  where row_value #>> '{source}' = 'line';
  if coalesce(v_line, 0) <> 1 then
    raise exception 'the LINE source did not appear in the breakdown (%)', v #> '{campaigns}';
  end if;
  if (v_qr #>> '{traffic,visitors}')::int <> 1 or (v_qr #>> '{accounts,signup_started}')::int <> 1 then
    raise exception 'filtering by a campaign did not narrow the numbers (%)', v_qr #> '{traffic}';
  end if;
  if jsonb_array_length(v_qr #> '{campaigns}') <> 1 then
    raise exception 'a campaign filter returned sources it was not asked for';
  end if;
end $$;
do $$
begin
  insert into public.usage_events(event_id, teacher_id, event, count, audience, campaign, version)
  values ('own-bad-campaign', 'a1000000-0000-4000-8000-0000000000b9', 'landing_view', 1, 'public',
          'utm_source=fb&name=somchai', 2);
  raise exception 'a free-text campaign value was stored as sent';
exception when check_violation then null;
end $$;

-- 6. ช่วงที่ไม่มีข้อมูลตอบ 0 ทุกช่อง ไม่ใช่ null ไม่ใช่ช่องหาย ไม่ใช่ค่าประมาณ
--    ยกเว้น pending_requests ซึ่งเป็นคิวคำขอ ณ ตอนนี้ ไม่ใช่ตัวเลขของช่วงเวลา (หน้าเว็บต้องเขียนกำกับ)
do $$
declare
  v jsonb := (select value from owner_probe where name = 'empty');
  v_path text;
begin
  foreach v_path in array array[
    'traffic,visitors', 'traffic,sessions', 'traffic,landing_views', 'traffic,pricing_views',
    'demo,started', 'demo,completed',
    'accounts,signup_started', 'accounts,signup_completed', 'accounts,email_verified',
    'accounts,onboarding_completed',
    'teachers,opened_app', 'teachers,activated', 'teachers,returning',
    'money,pro_requested', 'money,paying_customers', 'money,verified_payments',
    'money,gross_baht', 'money,refund_baht', 'money,net_baht'] loop
    if v #> string_to_array(v_path, ',') is null then
      raise exception 'an empty period dropped the field % instead of reporting 0', v_path;
    end if;
    if (v #>> string_to_array(v_path, ','))::numeric <> 0 then
      raise exception 'an empty period invented a value for % (%)', v_path, v #>> string_to_array(v_path, ',');
    end if;
  end loop;
  if v #>> '{campaigns}' <> '[]' or v #>> '{renewal}' <> '[]' then
    raise exception 'an empty period returned rows it could not have';
  end if;
  if v #>> '{generated_at}' is null or v #>> '{filters,from}' <> '2000-01-01' then
    raise exception 'the answer does not say when it was made or what it covered';
  end if;
end $$;

-- 7. เงินมาจากหลักฐานธนาคาร · event จากเบราว์เซอร์ขยับไม่ได้แม้แต่บาทเดียว
do $$
declare
  v_request uuid;
  v_payment uuid;
  v_from constant date := public.thai_today() - 210;
  v_to constant date := public.thai_today() - 200;
  v_at constant timestamptz := ((public.thai_today() - 205)::timestamp at time zone 'Asia/Bangkok')
    + interval '10 hours';
  v jsonb;
begin
  v := public.owner_analytics(v_from, v_to);
  if (v #>> '{money,gross_baht}')::int <> 0 or (v #>> '{money,paying_customers}')::int <> 0 then
    raise exception 'browser events alone produced revenue (%)', v #> '{money}';
  end if;

  insert into public.plan_requests(provider_id, months, amount, created_at)
  values ('a1000000-0000-4000-8000-0000000000a3', 1, 299, v_at) returning id into v_request;
  select evidence_id into v_payment from public.approve_plan_request_verified(
    v_request, 'BANK-OWNER-DASH-1', 299, v_at, 'owner-analytics-test');

  v := public.owner_analytics(v_from, v_to);
  if (v #>> '{money,verified_payments}')::int <> 1 or (v #>> '{money,gross_baht}')::int <> 299
     or (v #>> '{money,net_baht}')::int <> 299 or (v #>> '{money,paying_customers}')::int <> 1 then
    raise exception 'verified bank evidence did not reach the dashboard (%)', v #> '{money}';
  end if;
  if (v #>> '{money,pro_requested}')::int <> 1 then
    raise exception 'a plan request created in the period was not counted';
  end if;

  -- คืนเงินบางส่วน: gross เท่าเดิม net ลดลง และผู้จ่ายยังเป็นลูกค้าที่มียอดสุทธิเป็นบวก
  perform public.record_plan_refund(v_payment, 'BANK-OWNER-DASH-2', 100, v_at, 'owner-analytics-test');
  v := public.owner_analytics(v_from, v_to);
  if (v #>> '{money,gross_baht}')::int <> 299 or (v #>> '{money,refund_baht}')::int <> 100
     or (v #>> '{money,net_baht}')::int <> 199 or (v #>> '{money,paying_customers}')::int <> 1 then
    raise exception 'a refund was not subtracted the way the definition says (%)', v #> '{money}';
  end if;

  -- ยิง event การใช้งานเพิ่มอีกเป็นกอง ยอดเงินต้องไม่ขยับ
  insert into public.usage_events
    (event_id, teacher_id, provider_id, event, count, mode, audience, version, at) values
    ('own-money-1', 'a1000000-0000-4000-8000-0000000000b4', 'a1000000-0000-4000-8000-0000000000a3',
     'payment_recorded', 9999, 'real', 'public', 2, v_at),
    ('own-money-2', 'a1000000-0000-4000-8000-0000000000b4', 'a1000000-0000-4000-8000-0000000000a3',
     'invoice_issued', 9999, 'real', 'public', 2, v_at);
  v := public.owner_analytics(v_from, v_to);
  if (v #>> '{money,gross_baht}')::int <> 299 or (v #>> '{money,net_baht}')::int <> 199
     or (v #>> '{money,verified_payments}')::int <> 1 then
    raise exception 'a browser event changed the revenue figures (%)', v #> '{money}';
  end if;
end $$;

-- 8. ตัวกรองที่ไม่มีทางถูกต้องต้องถูกปฏิเสธ ไม่ใช่ตอบเลขมั่ว ๆ กลับไป
do $$
begin
  perform public.owner_analytics(public.thai_today(), public.thai_today() - 5);
  raise exception 'a backwards date range was accepted';
exception when invalid_parameter_value then null;
end $$;
do $$
begin
  perform public.owner_analytics(null, null, 'investors');
  raise exception 'an unknown audience was accepted';
exception when invalid_parameter_value then null;
end $$;

rollback;
