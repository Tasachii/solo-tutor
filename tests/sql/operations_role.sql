-- E-05 · บทบาท solo_operations ต้องทำงานตรวจได้ และต้องทำอย่างอื่นไม่ได้
-- ถ้าเทสนี้ล้ม แปลว่างานตรวจรายชั่วโมงถือสิทธิ์เกินความจำเป็น หรือถือสิทธิ์น้อยจนนับไม่ได้จริง
\set ON_ERROR_STOP on
begin;

-- ต้องมีบทบาทและต้องเข้าสู่ระบบเองไม่ได้ (ผู้ดูแลตั้งรหัสผ่านนอก migration)
do $$
declare
  v_exists boolean;
  v_canlogin boolean;
  v_superuser boolean;
  v_bypassrls boolean;
begin
  select true, rolcanlogin, rolsuper, rolbypassrls
    into v_exists, v_canlogin, v_superuser, v_bypassrls
    from pg_roles where rolname = 'solo_operations';
  if not coalesce(v_exists, false) then
    raise exception 'solo_operations role is missing';
  end if;
  if v_canlogin then
    raise exception 'solo_operations must not be able to log in until an operator sets a password';
  end if;
  if v_superuser or v_bypassrls then
    raise exception 'solo_operations must never be superuser or bypass RLS';
  end if;
end $$;

-- ข้อมูลตัวอย่างที่งานตรวจต้องนับเจอ: error ที่เพิ่งเกิด และคำขอแพ็กที่ค้างเกิน 24 ชม.
insert into public.client_errors (message, route, app_version, mode, created_at)
values ('boom', '/app/today', 'test', 'real', now() - interval '5 minutes');

do $$
declare
  v_counts record;
begin
  -- ในบทบาทที่มีสิทธิ์เต็ม ฟังก์ชันต้องเห็นแถวที่เพิ่งใส่
  select * into v_counts from public.operations_snapshot();
  if v_counts.recent_client_errors < 1 then
    raise exception 'operations_snapshot did not count a fresh client error';
  end if;
end $$;

-- แกนหลักของ E-05: บทบาทสิทธิ์ต่ำนับได้ตรงกัน ทั้งที่ select ตารางตรง ๆ ไม่ได้
set local role solo_operations;

do $$
declare
  v_counts record;
begin
  select * into v_counts from public.operations_snapshot();
  if v_counts.recent_client_errors < 1 then
    raise exception 'solo_operations counted 0 errors — RLS is hiding rows and the health check would be green forever';
  end if;
end $$;

-- อ่านตารางตรง ๆ ต้องไม่ได้ แม้แต่ตารางที่ฟังก์ชันนับให้
do $$
begin
  perform 1 from public.client_errors limit 1;
  raise exception 'solo_operations must not select public.client_errors directly';
exception
  when insufficient_privilege then null;
end $$;

do $$
begin
  perform 1 from public.message_outbox limit 1;
  raise exception 'solo_operations must not select public.message_outbox directly';
exception
  when insufficient_privilege then null;
end $$;

do $$
begin
  perform 1 from public.ledger_snapshots limit 1;
  raise exception 'solo_operations must not reach the teacher ledger';
exception
  when insufficient_privilege then null;
end $$;

-- เขียนต้องไม่ได้เลย
do $$
begin
  insert into public.client_errors (message, route, app_version, mode)
  values ('should not be allowed', '/x', 'test', 'real');
  raise exception 'solo_operations must not insert into public.client_errors';
exception
  when insufficient_privilege then null;
end $$;

-- ยกเว้นการล้างตัวนับกันยิงซ้ำ ซึ่งเป็นงานเดียวที่ต้องเขียน
select public.cleanup_public_rate_limits();

reset role;
rollback;
