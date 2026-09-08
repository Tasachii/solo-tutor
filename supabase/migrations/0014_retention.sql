-- P06 · ระยะเก็บข้อมูล — ทำให้ตัวเลขใน docs/data-inventory.md เป็นของจริง ไม่ใช่ความตั้งใจ
--
-- เดิมไม่มีงานลบเลย ทุกแถวอยู่ตลอดไป เอกสารความเป็นส่วนตัวจึงพูดถึงระยะเก็บที่ระบบไม่ได้ทำตาม
--
-- **ยังไม่ตั้งเวลาให้รันเอง** โดยตั้งใจ การลบข้อมูลย้อนกลับไม่ได้ และระยะเก็บเป็นการตัดสินใจ
-- ทางกฎหมายที่ผู้เชี่ยวชาญต้องตรวจก่อน (docs/data-inventory.md) ค่าเริ่มต้นของฟังก์ชันจึงเป็น
-- โหมดนับอย่างเดียว ต้องส่ง p_dry_run := false อย่างจงใจถึงจะลบจริง
--
-- สิ่งที่ฟังก์ชันนี้ **ไม่แตะเลย**: สมุดบัญชีของครู (`ledger_snapshots` เป็น ciphertext ที่เราถอดไม่ได้
-- และเป็นสำเนาเดียวของครูบางคน), บัญชีครู, หลักฐานการเงินค่าสมาชิก (`plan_financial_evidence`,
-- `plan_requests`) ซึ่งกฎหมายบัญชีกำหนดให้เก็บนานกว่า และการผูก LINE ที่ยังใช้งานอยู่

create or replace function public.apply_retention(p_dry_run boolean default true)
returns table (data_set text, cutoff timestamptz, affected bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- ค่าที่เสนอไว้ใน docs/data-inventory.md ทีมยืนยันและผู้เชี่ยวชาญตรวจก่อนเปิดใช้
  c_errors constant timestamptz := now() - interval '90 days';
  -- แยกสองชั้นตามแผนข้อ 6.5: เหตุการณ์ของผู้เยี่ยมชมมีค่าเฉพาะช่วงสั้น ๆ ที่ยังดู funnel รายวัน
  -- ส่วนเหตุการณ์ที่ครูลงมือทำคือบันทึกการใช้งานจริง ต้องอยู่นานพอจะดูการกลับมาใช้ข้ามเทอม
  c_visitor constant timestamptz := now() - interval '30 days';
  c_usage constant timestamptz := now() - interval '24 months';
  visitor_events constant text[] := array[
    'landing_view', 'pricing_view', 'demo_started', 'demo_completed',
    'signup_started', 'app_open'];
  c_outbox constant timestamptz := now() - interval '12 months';
  c_chats constant timestamptz := now() - interval '12 months';
  c_waitlist constant timestamptz := now() - interval '12 months';
  c_webhook constant timestamptz := now() - interval '30 days';
  n bigint;
begin
  -- รายงานข้อผิดพลาดจากเครื่องครู — มี stack และ route ไม่มีชื่อเด็ก
  if p_dry_run then
    select count(*) into n from public.client_errors where created_at < c_errors;
  else
    with gone as (delete from public.client_errors where created_at < c_errors returning 1)
    select count(*) into n from gone;
  end if;
  data_set := 'client_errors'; cutoff := c_errors; affected := n; return next;

  -- เหตุการณ์ของผู้เยี่ยมชม — pageview, เริ่มลองเดโม, เริ่มสมัคร
  if p_dry_run then
    select count(*) into n from public.usage_events
      where at < c_visitor and event = any(visitor_events);
  else
    with gone as (
      delete from public.usage_events where at < c_visitor and event = any(visitor_events) returning 1
    )
    select count(*) into n from gone;
  end if;
  data_set := 'usage_events_visitor'; cutoff := c_visitor; affected := n; return next;

  -- เหตุการณ์ที่ครูลงมือทำ — ออกบิล รับเงิน สมัครสำเร็จ ตั้งค่าเสร็จ
  if p_dry_run then
    select count(*) into n from public.usage_events
      where at < c_usage and not (event = any(visitor_events));
  else
    with gone as (
      delete from public.usage_events where at < c_usage and not (event = any(visitor_events)) returning 1
    )
    select count(*) into n from gone;
  end if;
  data_set := 'usage_events_teacher'; cutoff := c_usage; affected := n; return next;

  -- ข้อความที่ส่งผ่าน OA — เนื้อหามีชื่อเด็กและยอดเงิน จึงลบเนื้อหาทิ้ง
  -- แต่คงแถวและ dedupe_key ไว้ ไม่งั้นข้อความเก่าจะถูกส่งซ้ำได้อีกครั้ง
  if p_dry_run then
    select count(*) into n from public.message_outbox
      where created_at < c_outbox and status in ('sent','failed','skipped') and body <> '';
  else
    with cleared as (
      update public.message_outbox set body = ''
        where created_at < c_outbox and status in ('sent','failed','skipped') and body <> ''
        returning 1
    )
    select count(*) into n from cleared;
  end if;
  data_set := 'message_outbox_body'; cutoff := c_outbox; affected := n; return next;

  -- แชทขาเข้าจากผู้ปกครอง
  if p_dry_run then
    select count(*) into n from public.chats where occurred_at < c_chats;
  else
    with gone as (delete from public.chats where occurred_at < c_chats returning 1)
    select count(*) into n from gone;
  end if;
  data_set := 'chats'; cutoff := c_chats; affected := n; return next;

  -- ฟอร์มจองสิทธิ์ — ชื่อและช่องทางติดต่อของคนที่ยังไม่ได้เป็นลูกค้า
  if p_dry_run then
    select count(*) into n from public.waitlist where created_at < c_waitlist;
  else
    with gone as (delete from public.waitlist where created_at < c_waitlist returning 1)
    select count(*) into n from gone;
  end if;
  data_set := 'waitlist'; cutoff := c_waitlist; affected := n; return next;

  -- รหัส event ของ LINE ที่เก็บไว้กันประมวลผลซ้ำ หมดประโยชน์เร็ว
  if p_dry_run then
    select count(*) into n from public.line_webhook_events where claimed_at < c_webhook;
  else
    with gone as (delete from public.line_webhook_events where claimed_at < c_webhook returning 1)
    select count(*) into n from gone;
  end if;
  data_set := 'line_webhook_events'; cutoff := c_webhook; affected := n; return next;
end
$$;

revoke all on function public.apply_retention(boolean) from public, anon, authenticated;
grant execute on function public.apply_retention(boolean) to service_role;

comment on function public.apply_retention(boolean) is
  'ลบข้อมูลที่พ้นระยะเก็บตาม docs/data-inventory.md — ค่าเริ่มต้นนับอย่างเดียว ต้องส่ง false ถึงจะลบจริง · ไม่แตะสมุดบัญชีครู บัญชีครู และหลักฐานการเงิน';
