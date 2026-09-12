-- อ่านอย่างเดียว · พิมพ์เฉพาะจำนวนนับและค่าจริง/เท็จ ไม่มีความลับและไม่มีข้อมูลบุคคล
\set ON_ERROR_STOP on
\pset border 2
\echo '=== 1. LINE OA ผูกถึงขั้นไหน ==='
select
  (select count(*) from public.providers)                          as ครูในระบบ,
  (select count(*) from public.line_channels)                      as ช่องทางที่ตั้งค่าแล้ว,
  (select count(*) from public.line_channels where status='active') as ช่องทางพร้อมส่ง,
  (select count(*) from public.line_channels where last_verified_at is not null) as เคยตรวจผ่าน,
  (select count(*) from public.line_workspaces)                    as พื้นที่ทำงานที่ผูก,
  (select count(*) from public.line_recipients)                    as ผู้ปกครองที่ผูกแล้ว,
  (select count(*) from public.line_link_codes where expires_at > now()) as รหัสที่ยังไม่หมดอายุ,
  (select count(*) from public.line_webhook_events)                as เหตุการณ์จาก_webhook;

\echo '=== 1b. บัญชีครูที่ผูกช่อง LINE ไว้ (อีเมลปิดบางส่วน — ไว้รู้ว่าต้องล็อกอินบัญชีไหน) ==='
select
  left(u.email, 2) || '***@' || split_part(u.email, '@', 2) as อีเมลที่เชื่อม_OA,
  c.status as สถานะช่อง,
  c.display_name as ชื่อ_OA,
  (c.last_verified_at at time zone 'Asia/Bangkok')::timestamp(0) as ตรวจผ่านเมื่อ_เวลาไทย
from public.line_channels c join auth.users u on u.id = c.provider_id;

\echo '=== 1c. 3 ชั่วโมงล่าสุด: webhook รับอะไรบ้าง และรหัสจับคู่ถูกใช้ไหม (ไม่พิมพ์ตัวรหัส) ==='
select
  (claimed_at at time zone 'Asia/Bangkok')::timestamp(0) as รับเมื่อ_เวลาไทย,
  status as สถานะ,
  left(coalesce(last_error, ''), 80) as ข้อผิดพลาด
from public.line_webhook_events
where claimed_at >= now() - interval '3 hours'
order by claimed_at desc limit 20;
select
  (created_at at time zone 'Asia/Bangkok')::timestamp(0) as ออกรหัสเมื่อ_เวลาไทย,
  case when used_at is not null then 'ใช้แล้ว' when expires_at < now() then 'หมดอายุ' else 'ยังไม่ถูกใช้' end as สถานะ,
  (used_at at time zone 'Asia/Bangkok')::timestamp(0) as ใช้เมื่อ_เวลาไทย
from public.line_link_codes
where created_at >= now() - interval '3 hours'
order by created_at desc limit 20;

\echo '=== 2. คิวข้อความ — แยก "จากเดโม" ออกจากของจริง (dedupe_key ของเดโมมี :demo: ตั้งแต่ 9 ก.ย.) ==='
select
  status as สถานะ,
  count(*) filter (where dedupe_key not like '%:demo:%') as ของจริง,
  count(*) filter (where dedupe_key like '%:demo:%')     as จากเดโม
from public.message_outbox group by status order by status;

\echo '=== 3. ตัวเลขการใช้งานโหมดจริง แยกตามวัน ==='
select at::date as วันที่, event as เหตุการณ์, count(*) as ครั้ง, count(distinct teacher_id) as เบราว์เซอร์
from public.usage_events where mode = 'real' group by 1, 2 order by 1 desc, 3 desc;

\echo '=== 4. สรุปรวมโหมดจริง ==='
select
  count(distinct teacher_id) as เบราว์เซอร์ทั้งหมด,
  count(*) filter (where event = 'invoice_issued')   as ออกบิล,
  count(*) filter (where event = 'payment_recorded') as บันทึกรับเงิน,
  count(*) filter (where event = 'demo_completed')   as ทำเดโมครบลูป,
  count(*) filter (where event = 'signup_started')   as กดสมัคร,
  min(at)::date as วันแรก, max(at)::date as วันล่าสุด
from public.usage_events where mode = 'real';

\echo '=== 5. คนที่กลับมาใช้อีกวัน (โหมดจริง) ==='
select วัน_ที่ใช้งาน, count(*) as จำนวนเบราว์เซอร์ from (
  select teacher_id, count(distinct at::date) as วัน_ที่ใช้งาน
  from public.usage_events where mode = 'real' group by teacher_id
) t group by 1 order by 1;

\echo '=== 6. เงินที่ตรวจกับธนาคารแล้ว ==='
select
  (select count(*) from public.plan_requests where status = 'pending') as คำขอ_Pro_ที่รอตรวจ,
  (select count(*) from public.plan_requests)                          as คำขอ_Pro_ทั้งหมด,
  (select count(*) from public.plan_financial_evidence where evidence_type = 'payment') as ครั้งที่รับเงิน,
  (select coalesce(sum(amount), 0) from public.plan_financial_evidence where evidence_type = 'payment') as ยอดรับรวม;

\echo '=== 7. สุขภาพระบบ (ตัวเดียวกับที่งานรายชั่วโมงดู) ==='
select * from public.operations_snapshot();
