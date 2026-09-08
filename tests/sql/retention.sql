-- P06 · apply_retention ต้องลบเฉพาะสิ่งที่พ้นระยะเก็บ และต้องไม่แตะสิ่งที่ห้ามลบ
-- เทสนี้คือเหตุผลเดียวที่จะกล้าเปิดใช้งานลบจริงบนฐานของครู
\set ON_ERROR_STOP on
begin;

-- แถวเก่าที่ควรถูกลบ และแถวใหม่ที่ต้องรอด อย่างละหนึ่งของแต่ละชุดข้อมูล
insert into public.client_errors (message, route, mode, created_at) values
  ('old', '/x', 'real', now() - interval '120 days'),
  ('new', '/x', 'real', now() - interval '10 days');

-- ตัวนับแยกสองชั้น: เหตุการณ์ผู้เยี่ยมชมอยู่ 30 วัน เหตุการณ์ที่ครูลงมือทำอยู่ 24 เดือน
insert into public.usage_events (teacher_id, event, count, at) values
  -- ผู้เยี่ยมชม: เก่ากว่า 30 วัน ต้องหาย · ใหม่กว่านั้นต้องอยู่
  ('20000000-0000-0000-0000-000000000001', 'landing_view', 1, now() - interval '90 days'),
  ('20000000-0000-0000-0000-000000000002', 'landing_view', 1, now() - interval '3 days'),
  -- ครูลงมือทำ: อายุ 90 วันยังต้องอยู่ ห้ามโดนกฎ 30 วันของผู้เยี่ยมชมกวาดไปด้วย
  ('20000000-0000-0000-0000-000000000003', 'invoice_issued', 1, now() - interval '90 days'),
  -- ครูลงมือทำแต่เกิน 24 เดือน ต้องหาย
  ('20000000-0000-0000-0000-000000000004', 'invoice_issued', 1, now() - interval '30 months');

insert into public.waitlist (profession_id, name, contact, created_at) values
  ('tutor', 'เก่า', 'old@example.test', now() - interval '18 months'),
  ('tutor', 'ใหม่', 'new@example.test', now() - interval '1 month');

-- โหมดนับอย่างเดียวคือค่าเริ่มต้น ต้องไม่ลบอะไรเลย
do $$
declare
  v_reported bigint;
  v_left bigint;
begin
  select affected into v_reported from public.apply_retention() where data_set = 'client_errors';
  if v_reported <> 1 then
    raise exception 'dry run should have reported 1 stale client error, got %', v_reported;
  end if;
  select count(*) into v_left from public.client_errors;
  if v_left <> 2 then
    raise exception 'dry run deleted rows — it must only count. rows left: %', v_left;
  end if;
end $$;

-- เรียกซ้ำอีกครั้งก็ยังต้องไม่ลบ ป้องกันการเผลอทำให้ค่าเริ่มต้นกลายเป็นลบจริง
select public.apply_retention();
do $$
declare v_left bigint;
begin
  select count(*) into v_left from public.client_errors;
  if v_left <> 2 then raise exception 'default call must never delete'; end if;
end $$;

-- ลบจริงต้องส่ง false อย่างจงใจ
select public.apply_retention(false);

-- ตรวจเฉพาะแถวของเทสนี้ ตารางเหล่านี้อาจมีแถวจากไฟล์ทดสอบก่อนหน้าอยู่ด้วย
do $$
begin
  if exists (select 1 from public.client_errors where message = 'old') then
    raise exception 'retention kept a client error past its window';
  end if;
  if not exists (select 1 from public.client_errors where message = 'new') then
    raise exception 'retention deleted a client error that is inside the window';
  end if;

  if exists (select 1 from public.usage_events
      where teacher_id = '20000000-0000-0000-0000-000000000001') then
    raise exception 'retention kept a visitor event past its 30 day window';
  end if;
  if not exists (select 1 from public.usage_events
      where teacher_id = '20000000-0000-0000-0000-000000000002') then
    raise exception 'retention deleted a visitor event that is inside its window';
  end if;
  -- แกนของการแยกสองชั้น: บิลที่ครูออกเมื่อ 90 วันก่อนคือบันทึกการใช้งานจริง ห้ามหายไปกับกฎ 30 วัน
  if not exists (select 1 from public.usage_events
      where teacher_id = '20000000-0000-0000-0000-000000000003') then
    raise exception 'retention deleted a teacher activity event using the visitor window';
  end if;
  if exists (select 1 from public.usage_events
      where teacher_id = '20000000-0000-0000-0000-000000000004') then
    raise exception 'retention kept a teacher activity event past 24 months';
  end if;

  if exists (select 1 from public.waitlist where contact = 'old@example.test') then
    raise exception 'retention kept a waitlist row past its window';
  end if;
  if not exists (select 1 from public.waitlist where contact = 'new@example.test') then
    raise exception 'retention deleted a waitlist row that is inside the window';
  end if;
end $$;

-- สิ่งที่ห้ามแตะ: สมุดบัญชีครูเป็น ciphertext ที่เราถอดไม่ได้ และเป็นสำเนาเดียวของครูบางคน
-- ส่วนหลักฐานการเงินต้องเก็บตามกฎหมายบัญชี
do $$
declare
  v_snapshots bigint;
  v_providers bigint;
begin
  select count(*) into v_snapshots from public.ledger_snapshots;
  select count(*) into v_providers from public.providers;
  perform public.apply_retention(false);
  if (select count(*) from public.ledger_snapshots) <> v_snapshots then
    raise exception 'retention touched the teacher ledger — it must never do that';
  end if;
  if (select count(*) from public.providers) <> v_providers then
    raise exception 'retention touched teacher accounts';
  end if;
end $$;

-- ผู้ใช้ทั่วไปเรียกไม่ได้ งานลบต้องมาจากฝั่งเซิร์ฟเวอร์เท่านั้น
do $$
begin
  set local role authenticated;
  perform public.apply_retention();
  reset role;
  raise exception 'authenticated must not be able to run retention';
exception
  when insufficient_privilege then reset role;
end $$;

rollback;
