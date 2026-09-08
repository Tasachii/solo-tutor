-- E-05 · บทบาทสิทธิ์ต่ำสำหรับงานตรวจสุขภาพระบบรายชั่วโมง
--
-- `operations.yml` ต่อฐานด้วย `postgres` ซึ่งอ่านและเขียนได้ทุกตาราง ทั้งที่งานนั้นต้องการแค่จำนวนนับห้าค่า
-- ถ้า secret ของงานตรวจหลุด ผู้ที่ได้ไปจะอ่านสมุดบัญชีทั้งฐานหรือแก้บิลได้ทันที
--
-- แนวทางที่เลือก: ไม่ให้บทบาทนี้ `select` ตารางใด ๆ เลย แต่ให้เรียกฟังก์ชันเดียวที่คืน "ตัวเลข" เท่านั้น
-- เหตุผลสำคัญ: ถ้าให้สิทธิ์ select ตรง ๆ RLS จะกรองแถวจนบทบาทนี้นับได้ 0 เสมอ
-- การตรวจสุขภาพจะเขียวตลอดโดยไม่มีความหมาย ซึ่งอันตรายกว่าไม่มีการตรวจเลย
--
-- บทบาทเป็น NOLOGIN โดยตั้งใจ — migration ไม่ควรกำหนดรหัสผ่าน ผู้ดูแลตั้งเองนอกไฟล์นี้ (docs/backup-restore.md)

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'solo_operations') then
    create role solo_operations nologin;
  end if;
end
$$;

grant usage on schema public to solo_operations;

-- คืนเฉพาะจำนวนนับ ไม่มีข้อความ error ไม่มีตัวตนครู ไม่มีข้อมูลนักเรียน ไม่มีเนื้อหาข้อความ
-- security definer เพื่อให้ผ่าน RLS ได้ในระดับที่จำเป็น และ search_path ถูกตรึงกันการสวมชื่อวัตถุ
create or replace function public.operations_snapshot()
returns table (
  recent_client_errors bigint,
  stale_plan_requests bigint,
  manual_review_outbox bigint,
  stale_processing_outbox bigint,
  stale_queued_outbox bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    (select count(*) from public.client_errors
       where created_at >= now() - interval '1 hour'),
    (select count(*) from public.plan_requests
       where status = 'pending' and created_at < now() - interval '24 hours'),
    (select count(*) from public.message_outbox where status = 'manual_review'),
    (select count(*) from public.message_outbox
       where status = 'processing' and claimed_at < now() - interval '15 minutes'),
    (select count(*) from public.message_outbox
       where status = 'queued' and scheduled_at < now() - interval '1 hour');
$$;

revoke all on function public.operations_snapshot() from public, anon, authenticated;
grant execute on function public.operations_snapshot() to solo_operations, service_role;

-- ล้างค่าแฮชกันยิงซ้ำที่หมดอายุ เป็นการเขียนอย่างเดียวที่งานตรวจต้องทำ
-- ฟังก์ชันเดิมเป็น security definer และแตะเฉพาะ public_rate_limits จึงไม่เปิดทางไปตารางอื่น
grant execute on function public.cleanup_public_rate_limits() to solo_operations;

comment on function public.operations_snapshot() is
  'จำนวนนับสำหรับ operations.yml เท่านั้น — ห้ามคืนข้อความ ตัวตน หรือยอดเงิน';
comment on role solo_operations is
  'สิทธิ์ต่ำสุดสำหรับ operations.yml — เรียกได้แค่ operations_snapshot() และ cleanup_public_rate_limits()';
