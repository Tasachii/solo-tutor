\set ON_ERROR_STOP on
-- Read-only hourly health thresholds. Output contains counts only, never error text,
-- teacher identity, student data, message bodies, or payment notes.
begin transaction read only;

-- ตัวเลขทั้งหมดมาจากฟังก์ชันเดียว เพื่อให้บทบาทสิทธิ์ต่ำ (solo_operations) รันสคริปต์นี้ได้
-- โดยไม่ต้องมีสิทธิ์ select ตารางใด ๆ — ดู supabase/migrations/0013_operations_role.sql
--
-- ถ้าฟังก์ชันยังไม่มี แปลว่าฐานจริงยังไม่ได้ apply ไมเกรชัน ไม่ใช่ว่าระบบมีปัญหา
-- ยังต้องล้มอยู่ (การตรวจไม่ทำงานคือความเสี่ยงจริง) แต่ต้องบอกให้ชัดว่าต้องไปทำอะไร
-- ไม่งั้น issue ที่เปิดให้เจ้าของจะมีแค่ 'function does not exist' ซึ่งอ่านไม่ออกว่าใครต้องแก้
do $$
begin
  if to_regprocedure('public.operations_snapshot()') is null then
    raise exception 'การตรวจรายชั่วโมงยังใช้ไม่ได้ เพราะฐานจริงยังไม่มี public.operations_snapshot()'
      using detail = 'ตัวเลขสุขภาพระบบทั้งหมดมาจากฟังก์ชันนี้ ตอนนี้จึงยังไม่มีใครเฝ้าคิวคำขอ Pro ข้อความค้างส่ง และ error จากเครื่องครู',
            hint = 'ผู้ดูแลต้อง apply supabase/migrations/0013_operations_role.sql (และไมเกรชันที่ค้างอยู่ตัวอื่น) กับโปรเจกต์จริงก่อน — ดู docs/owner-setup.md',
            errcode = '42883';
  end if;
end $$;

select * from public.operations_snapshot();

do $$
declare
  v_recent_errors bigint;
  v_stale_plans bigint;
  v_manual_review bigint;
  v_stale_processing bigint;
  v_stale_queued bigint;
begin
  select
    recent_client_errors, stale_plan_requests,
    manual_review_outbox, stale_processing_outbox, stale_queued_outbox
  into v_recent_errors, v_stale_plans, v_manual_review, v_stale_processing, v_stale_queued
  from public.operations_snapshot();

  if v_recent_errors + v_stale_plans + v_manual_review + v_stale_processing + v_stale_queued > 0 then
    raise exception 'operations thresholds exceeded'
      using detail = format(
        'recent_errors=%s stale_plans=%s manual_review=%s stale_processing=%s stale_queued=%s',
        v_recent_errors, v_stale_plans, v_manual_review, v_stale_processing, v_stale_queued
      );
  end if;
end $$;

commit;
