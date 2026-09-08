-- D-08: ครูต้องเห็นการคืนเงินของตัวเอง โดยไม่เห็นของคนอื่น ไม่เห็นข้อมูลปฏิบัติการ
-- และการคืนเงินต้องไม่ไปแตะสิทธิ์แพ็ก ยอดทุกตัวในเทสนี้เป็นตัวเลขสมมติ ไม่ใช่ราคาแพ็กจริง
\set ON_ERROR_STOP on
begin;

insert into auth.users(id) values
  ('f1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000002');
-- ครูมีคำขอค้างได้ทีละหนึ่ง คำขอใบที่สองของครูคนแรกจึงเปิดหลังอนุมัติใบแรกแล้ว
insert into public.plan_requests(provider_id, months, amount, note) values
  ('f1000000-0000-4000-8000-000000000001', 1, 1200, 'synthetic refund test one'),
  ('f1000000-0000-4000-8000-000000000002', 1, 1500, 'synthetic refund test other');

-- สัญญาด้านสิทธิ์: ครูเรียกฟังก์ชันอ่านได้ แต่ตารางหลักฐานยังปิดสนิท และ anon ไม่ได้อะไรเลย
do $$
declare v_args text[] := (select proargnames from pg_proc where proname = 'list_plan_refunds');
begin
  if not has_function_privilege('authenticated', 'public.list_plan_refunds()', 'execute') then
    raise exception 'teacher cannot read their own refunds';
  end if;
  if has_function_privilege('anon', 'public.list_plan_refunds()', 'execute') then
    raise exception 'signed-out caller can read refunds';
  end if;
  if has_table_privilege('authenticated', 'public.plan_financial_evidence', 'select') then
    raise exception 'refund read path opened the evidence table to teachers';
  end if;
  if not (select prosecdef from pg_proc where proname = 'list_plan_refunds')
    or not exists (select 1 from pg_proc, unnest(coalesce(proconfig, '{}'::text[])) as c
      where proname = 'list_plan_refunds' and c like 'search_path=%') then
    raise exception 'refund reader is not a search_path-pinned security definer';
  end if;
  -- เลขอ้างอิงธนาคารและชื่อผู้ตรวจเป็นข้อมูลปฏิบัติการ ห้ามอยู่ในผลลัพธ์ฝั่งครู
  if v_args && array['bank_reference', 'verified_by', 'verified_at', 'payment_evidence_id'] then
    raise exception 'refund reader exposes operational evidence columns: %', v_args;
  end if;
end $$;

set role service_role;
do $$
declare
  v_full uuid := (select id from public.plan_requests where note = 'synthetic refund test one');
  v_partial uuid;
  v_other uuid := (select id from public.plan_requests where note = 'synthetic refund test other');
  v_payment uuid;
  v_at timestamptz := now() - interval '2 days';
  r record;
begin
  select evidence_id into v_payment from public.approve_plan_request_verified(
    v_full, 'SYNTHETIC-REFUND-PAY-A1', 1200, v_at, 'synthetic operator');
  perform public.record_plan_refund(v_payment, 'SYNTHETIC-REFUND-A1', 500, v_at + interval '1 hour', 'synthetic operator');
  perform public.record_plan_refund(v_payment, 'SYNTHETIC-REFUND-A2', 700, v_at + interval '2 hours', 'synthetic operator');

  insert into public.plan_requests(provider_id, months, amount, note)
  values ('f1000000-0000-4000-8000-000000000001', 1, 900, 'synthetic refund test two')
  returning id into v_partial;
  select evidence_id into v_payment from public.approve_plan_request_verified(
    v_partial, 'SYNTHETIC-REFUND-PAY-A2', 900, v_at, 'synthetic operator');
  perform public.record_plan_refund(v_payment, 'SYNTHETIC-REFUND-A3', 400, v_at + interval '3 hours', 'synthetic operator');

  select evidence_id into v_payment from public.approve_plan_request_verified(
    v_other, 'SYNTHETIC-REFUND-PAY-B1', 1500, v_at, 'synthetic operator');
  perform public.record_plan_refund(v_payment, 'SYNTHETIC-REFUND-B1', 600, v_at + interval '1 hour', 'synthetic operator');

  -- การบันทึกคืนเงินต้องไม่ตัดวันหรือลดสิทธิ์ของแพ็ก การเปลี่ยนสิทธิ์ต้องเป็นกระบวนการแยก
  select plan, plan_until into r from public.providers where id = 'f1000000-0000-4000-8000-000000000001';
  if r.plan <> 'pro' or r.plan_until < public.thai_today() then
    raise exception 'recording a refund revoked or shortened the plan: %', row_to_json(r);
  end if;
end $$;
reset role;

-- ครูคนแรก: เห็นเฉพาะของตัวเอง ยอดคืนสะสมถูกต้องแยกตามใบเสร็จ
set role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', false);
do $$
declare
  v_full uuid := (select id from public.plan_requests where note = 'synthetic refund test one');
  v_partial uuid := (select id from public.plan_requests where note = 'synthetic refund test two');
  r record;
begin
  if (select count(*) from public.list_plan_refunds()) <> 3 then
    raise exception 'teacher did not see exactly their own three refunds';
  end if;
  select count(*) as rows, min(paid_amount) as paid, max(refunded_total) as total,
         sum(refunded_amount)::integer as listed, min(receipt_no) as receipt
    into r from public.list_plan_refunds() where plan_request_id = v_full;
  if r.rows <> 2 or r.paid <> 1200 or r.total <> 1200 or r.listed <> 1200 or r.receipt is null then
    raise exception 'fully refunded receipt totals are wrong: %', row_to_json(r);
  end if;
  select count(*) as rows, min(paid_amount) as paid, max(refunded_total) as total
    into r from public.list_plan_refunds() where plan_request_id = v_partial;
  if r.rows <> 1 or r.paid <> 900 or r.total <> 400 then
    raise exception 'partly refunded receipt totals are wrong: %', row_to_json(r);
  end if;
  -- ใบเสร็จของครูอีกคนต้องไม่โผล่มา ไม่ว่าจะทางไหน
  if exists (select 1 from public.list_plan_refunds() f
      join public.plan_requests r2 on r2.id = f.plan_request_id
      where r2.provider_id <> 'f1000000-0000-4000-8000-000000000001') then
    raise exception 'teacher saw another teacher refund';
  end if;
  if exists (select 1 from public.list_plan_refunds() where refunded_amount = 600) then
    raise exception 'another teacher refund leaked by amount';
  end if;
end $$;

-- ครูคนที่สอง: เห็นแค่รายการเดียวของตัวเอง
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', false);
do $$
declare r record;
begin
  select count(*) as rows, min(refunded_amount) as amount, min(paid_amount) as paid
    into r from public.list_plan_refunds();
  if r.rows <> 1 or r.amount <> 600 or r.paid <> 1500 then
    raise exception 'second teacher saw the wrong refund set: %', row_to_json(r);
  end if;
end $$;

-- ไม่มี jwt = ไม่มีแถว ไม่ใช่เห็นทั้งตาราง
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  if (select count(*) from public.list_plan_refunds()) <> 0 then
    raise exception 'refunds are readable without a signed-in teacher';
  end if;
end $$;
reset role;

-- ใบเสร็จที่ยังไม่เคยคืนเงินต้องไม่มีแถวคืนเงินขึ้นมาเอง
insert into auth.users(id) values ('f1000000-0000-4000-8000-000000000003');
insert into public.plan_requests(provider_id, months, amount, note)
values ('f1000000-0000-4000-8000-000000000003', 1, 700, 'synthetic refund test none');
set role service_role;
select public.approve_plan_request_verified(
  (select id from public.plan_requests where note = 'synthetic refund test none'),
  'SYNTHETIC-REFUND-PAY-C1', 700, now() - interval '1 day', 'synthetic operator');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000003', false);
do $$
begin
  if (select count(*) from public.list_plan_refunds()) <> 0 then
    raise exception 'a receipt with no refund reported one';
  end if;
end $$;
reset role;

-- ลบบัญชีแล้วหลักฐานยังอยู่เพื่อการบัญชี แต่ทางอ่านฝั่งครูไม่มีเจ้าของให้แสดงอีก
delete from auth.users where id = 'f1000000-0000-4000-8000-000000000001';
do $$
begin
  if (select count(*) from public.plan_financial_evidence
      where bank_reference in ('SYNTHETIC-REFUND-A1', 'SYNTHETIC-REFUND-A2', 'SYNTHETIC-REFUND-A3')) <> 3 then
    raise exception 'account erasure removed retained refund evidence';
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', false);
do $$
begin
  if (select count(*) from public.list_plan_refunds()) <> 0 then
    raise exception 'refunds of an erased account are still served to a caller claiming its id';
  end if;
end $$;
reset role;

rollback;
