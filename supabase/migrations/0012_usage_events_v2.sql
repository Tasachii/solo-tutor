-- ตัวนับการใช้งาน v2 — ตอบให้ได้ว่ามีคนเข้าเว็บ ลอง Demo สมัคร และเริ่มใช้จริงกี่คน
-- ย้ายของเดิมโดยไม่ทิ้งแถว: แถว v1 ได้ event_id สังเคราะห์ audience 'public' และ version 1
-- at = เวลาที่เซิร์ฟเวอร์รับ ไม่ใช่เวลาที่ browser อ้าง ยกเว้นแถวที่ Auth ยืนยันเวลาให้เอง
-- ไม่มี IP ดิบ ไม่มี URL เต็ม ไม่มี query/hash ไม่มี token เอกสาร ไม่มีชื่อหรืออีเมลของใคร
alter table public.usage_events
  add column event_id text,
  add column session_id uuid,
  add column route text,
  add column audience text,
  add column version smallint not null default 1;

update public.usage_events set event_id = 'v1:' || id where event_id is null;
update public.usage_events set audience = 'public' where audience is null;

alter table public.usage_events
  alter column event_id set not null,
  -- ผู้เขียนที่ไม่ได้กันนับซ้ำเอง (งานฝั่งเซิร์ฟเวอร์ การย้ายข้อมูล) ยังต้องได้ id ที่ไม่ชนใคร
  -- ตัวนับในเบราว์เซอร์ส่ง event_id ของตัวเองเสมอ ค่า default นี้จึงไม่ทำให้การกันนับซ้ำอ่อนลง
  alter column event_id set default gen_random_uuid()::text,
  alter column audience set not null,
  alter column audience set default 'public',
  -- ยิงซ้ำด้วย event_id เดิมต้องไม่เพิ่มแถว ไม่ว่าจะมาจาก retry, re-render หรือสองแท็บ
  add constraint usage_events_event_id_key unique (event_id),
  add constraint usage_events_event_id_shape
    check (event_id = btrim(event_id) and char_length(event_id) between 3 and 120),
  add constraint usage_events_audience_check check (audience in ('public', 'team')),
  -- หมวดหน้าเท่านั้น ห้ามเก็บ path จริง: /document/:token ไม่มี analytics เลยจึงไม่มีในรายการนี้
  add constraint usage_events_route_check
    check (route is null or route in ('landing', 'pricing', 'legal', 'start', 'login', 'app', 'other')),
  add constraint usage_events_version_check check (version between 1 and 2);

-- ชื่อเหตุการณ์ที่ตารางยอมรับ: 4 ชื่อเดิมยังใช้ได้ ของใหม่เพิ่มเข้ามาพร้อมกับ producer
-- pro_requested / subscription_payment_verified / refund_verified ไม่อยู่ที่นี่โดยตั้งใจ
-- เพราะอ่านจากตารางการเงินฝั่งเซิร์ฟเวอร์ได้ตรงกว่า (public.plan_funnel_monthly ด้านล่าง)
alter table public.usage_events drop constraint usage_events_event_check;
alter table public.usage_events add constraint usage_events_event_check check (event in (
  'app_open', 'students_changed', 'invoice_issued', 'payment_recorded',
  'landing_view', 'pricing_view', 'demo_started', 'demo_completed',
  'signup_started', 'signup_completed', 'email_verified', 'onboarding_completed'));

create index usage_events_event_idx on public.usage_events (event, at desc);
create index usage_events_session_idx on public.usage_events (session_id, at desc)
  where session_id is not null;

-- มุมมองเดิมยังตอบคำถามเดิมได้ เพิ่มแกน audience เพื่อกันทราฟฟิกของทีมปนกับผู้ใช้จริง
drop view if exists public.usage_daily;
create view public.usage_daily as
select date_trunc('day', at at time zone 'Asia/Bangkok')::date as day,
       mode,
       audience,
       count(distinct teacher_id) filter (where event = 'app_open') as teachers_opened,
       sum(count) filter (where event = 'invoice_issued') as invoices_issued,
       sum(count) filter (where event = 'payment_recorded') as payments_recorded,
       max(count) filter (where event = 'students_changed') as max_students_seen
from public.usage_events group by 1, 2, 3 order by 1 desc;
revoke all on public.usage_daily from public, anon, authenticated;
grant select on public.usage_daily to service_role;

-- Funnel รายวัน: ตัวเศษและตัวส่วนอยู่แถวเดียวกัน แยกแกน Demo/จริง และแกนทีม/ผู้เยี่ยมชม
-- visitor = browser ID โดยประมาณ ไม่ใช่จำนวนคน · pageview = จำนวนการเปิดหน้า ไม่ใช่คน
-- ช่วงที่ไม่มีข้อมูลจะไม่มีแถว ผู้อ่านต้องแสดงเป็น 0/ไม่มีข้อมูล ไม่ใช่ประมาณค่าให้เอง
create view public.usage_funnel_daily as
select date_trunc('day', at at time zone 'Asia/Bangkok')::date as day,
       audience,
       mode,
       count(distinct teacher_id) as visitors,
       count(distinct session_id) as sessions,
       count(*) filter (where event = 'landing_view') as landing_views,
       count(*) filter (where event = 'pricing_view') as pricing_views,
       count(distinct session_id) filter (where event = 'demo_started') as demo_started,
       count(distinct session_id) filter (where event = 'demo_completed') as demo_completed,
       count(distinct session_id) filter (where event = 'signup_started') as signup_started,
       count(distinct provider_id) filter (where event = 'signup_completed') as signup_completed,
       count(distinct provider_id) filter (where event = 'email_verified') as email_verified,
       count(distinct teacher_id) filter (where event = 'onboarding_completed') as onboarding_completed,
       count(distinct teacher_id) filter (where event = 'app_open') as opened_app,
       coalesce(sum(count) filter (where event = 'invoice_issued'), 0) as invoices_issued,
       coalesce(sum(count) filter (where event = 'payment_recorded'), 0) as payments_recorded
from public.usage_events group by 1, 2, 3 order by 1 desc;
revoke all on public.usage_funnel_daily from public, anon, authenticated;
grant select on public.usage_funnel_daily to service_role;

-- ปลายทางของ funnel มาจากธุรกรรมฝั่งเซิร์ฟเวอร์ ไม่ใช่ event ของเบราว์เซอร์
-- pro_requested = คำขอแผนที่ถูกสร้างจริง · อีกสองค่ามาจากหลักฐานเงินที่ตรวจกับธนาคารแล้ว
-- refund นับตามเดือนที่เงินออก จึงหักกับ payment ข้ามเดือนได้ตามจริง ไม่ใช่ลบย้อนหลัง
create view public.plan_funnel_monthly as
with requested as (
  select date_trunc('month', created_at at time zone 'Asia/Bangkok')::date as month,
         count(*) as pro_requested,
         count(distinct provider_id) as pro_requesting_providers
  from public.plan_requests group by 1
), verified as (
  select date_trunc('month', occurred_at at time zone 'Asia/Bangkok')::date as month,
         count(*) filter (where evidence_type = 'payment') as subscription_payment_verified,
         count(*) filter (where evidence_type = 'refund') as refund_verified
  from public.plan_financial_evidence group by 1
)
select coalesce(requested.month, verified.month) as month,
       coalesce(requested.pro_requested, 0) as pro_requested,
       coalesce(requested.pro_requesting_providers, 0) as pro_requesting_providers,
       coalesce(verified.subscription_payment_verified, 0) as subscription_payment_verified,
       coalesce(verified.refund_verified, 0) as refund_verified
from requested full join verified on verified.month = requested.month
order by 1 desc;
revoke all on public.plan_funnel_monthly from public, anon, authenticated;
grant select on public.plan_funnel_monthly to service_role;

-- Retention is not defined here. public.apply_retention (0014_retention.sql) owns deletion for
-- this table and now splits it the way plan section 6.5 asks: 30 days for visitor events
-- (pageviews, demo, signup_started, app_open) and 24 months for what a teacher actually did.
-- It stays count-only until someone passes false on purpose. One deleter, one published window.
comment on table public.usage_events is
  'ตัวนับการใช้งานแบบ pseudonymous — ไม่มี IP ดิบ ชื่อ อีเมล URL เต็ม หรือ token เอกสาร · ระยะเก็บอยู่ที่ public.apply_retention เท่านั้น (ผู้เยี่ยมชม 30 วัน · งานที่ครูลงมือทำ 24 เดือน)';
