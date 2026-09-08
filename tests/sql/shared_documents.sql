\set ON_ERROR_STOP on
-- สัญญาของลิงก์เอกสารผู้ปกครอง: เผยแพร่ได้เฉพาะเจ้าของ · เปิดได้เฉพาะที่ยังไม่หมดอายุและยังไม่ถูกเพิกถอน
-- เดา token หรือ id ของครูคนอื่นไม่ได้ · เซิร์ฟเวอร์ไม่เคยเห็นกุญแจ จึงไม่มีคอลัมน์ให้ทดสอบว่ากุญแจรั่ว
-- token ส่งต่อระหว่างขั้นด้วย GUC ของ session ไม่ใช่ตัวแปร psql เพราะ psql ไม่แทนค่าใน dollar quote

insert into auth.users(id) values
  ('d3000000-0000-4000-8000-000000000001'),
  ('d3000000-0000-4000-8000-000000000002');

-- สิทธิ์พื้นฐาน: anon แตะตารางหรือฟังก์ชันของครูไม่ได้ · ครูเขียนตารางตรง ๆ ไม่ได้
do $$
begin
  if has_table_privilege('anon', 'public.shared_documents', 'select')
     or has_table_privilege('anon', 'public.shared_documents', 'insert') then
    raise exception 'anonymous callers can reach the shared document table directly';
  end if;
  if has_table_privilege('authenticated', 'public.shared_documents', 'insert')
     or has_table_privilege('authenticated', 'public.shared_documents', 'update')
     or has_table_privilege('authenticated', 'public.shared_documents', 'delete') then
    raise exception 'a teacher can write the table and bypass the publish and revoke rules';
  end if;
  if has_function_privilege('anon',
      'public.publish_shared_document(text,text,text,timestamptz,text,text)', 'execute') then
    raise exception 'anonymous callers can publish documents';
  end if;
  if has_function_privilege('anon', 'public.revoke_shared_document(text)', 'execute') then
    raise exception 'anonymous callers can revoke documents';
  end if;
  if has_function_privilege('authenticated', 'public.cleanup_shared_documents()', 'execute') then
    raise exception 'a teacher can delete shared document rows through cleanup';
  end if;
  if not has_function_privilege('anon', 'public.read_shared_document(text)', 'execute') then
    raise exception 'a parent holding the link cannot reach the public read';
  end if;
end $$;

-- การเปิดเผยของ public read: คืนแค่ซองข้อมูล ไม่มีอะไรบอกว่าเอกสารเป็นของครูคนไหน
do $$
declare v_result text;
begin
  select pg_get_function_result(f.oid) into v_result from pg_proc f
    where f.proname = 'read_shared_document' and f.pronamespace = 'public'::regnamespace;
  if v_result <> 'TABLE(kind text, cipher text, iv text, expires_at timestamp with time zone)' then
    raise exception 'the public read exposes more than the ciphertext envelope: %', v_result;
  end if;
end $$;

-- ครูคนแรกเผยแพร่สี่ใบ · เซิร์ฟเวอร์เป็นผู้ออก token และบีบอายุลิงก์ให้อยู่ในกรอบ
set role authenticated;
select set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000001', false);
do $$
declare r record;
begin
  select * into r from public.publish_shared_document(
    'invoice', 'cipher-live', 'iv-live', now() + interval '90 days', 'label-live', 'label-iv-live');
  if r.token !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'publish did not return a server generated base64url token: %', r.token;
  end if;
  perform set_config('solo.live_token', r.token, false);

  select * into r from public.publish_shared_document(
    'receipt', 'cipher-revoked', 'iv-revoked', now() + interval '90 days');
  if r.token = current_setting('solo.live_token') then
    raise exception 'two documents were given the same token';
  end if;
  perform set_config('solo.revoked_token', r.token, false);

  -- ขออายุ 10 ปีต้องถูกบีบเหลือ 180 วัน · ขอวันที่ผ่านมาแล้วต้องถูกดันเป็นอนาคต
  select * into r from public.publish_shared_document(
    'invoice', 'cipher-clamp-high', 'iv', now() + interval '10 years');
  if r.expires_at > now() + interval '180 days' + interval '1 minute' then
    raise exception 'a client could ask for a link that never expires';
  end if;
  select * into r from public.publish_shared_document(
    'invoice', 'cipher-clamp-low', 'iv', now() - interval '1 day');
  if r.expires_at <= now() then
    raise exception 'a client could publish a link that is already expired';
  end if;

  -- ป้ายชื่อต้องมากับ iv ของตัวเองเสมอ ไม่งั้นฝั่งครูถอดรหัสไม่ได้
  begin
    perform public.publish_shared_document(
      'invoice', 'c', 'iv', now() + interval '1 day', 'label-without-iv');
    raise exception 'a label was accepted without its iv';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.publish_shared_document('statement', 'c', 'iv', now() + interval '1 day');
    raise exception 'an unknown document kind was accepted';
  exception when sqlstate '22023' then null;
  end;

  if not public.revoke_shared_document(current_setting('solo.revoked_token')) then
    raise exception 'the owner could not revoke their own document';
  end if;
  if public.revoke_shared_document(current_setting('solo.revoked_token')) then
    raise exception 'revoking twice reported a second change that did not happen';
  end if;

  if (select count(*) from public.shared_documents) <> 4 then
    raise exception 'the owner does not see exactly their own four documents';
  end if;
end $$;
reset role;

-- ผู้ปกครองที่ถือลิงก์: ใบที่ยังใช้ได้เปิดออก · ที่ถูกเพิกถอน ถูกแก้ หรือแต่งขึ้นเองเปิดไม่ออก
set role anon;
do $$
declare
  v_live text := current_setting('solo.live_token');
  v_rows integer;
begin
  select count(*) into v_rows from public.read_shared_document(v_live);
  if v_rows <> 1 then raise exception 'a valid link did not return its ciphertext'; end if;
  if (select d.cipher from public.read_shared_document(v_live) d) <> 'cipher-live' then
    raise exception 'the public read returned the wrong ciphertext';
  end if;

  select count(*) into v_rows from public.read_shared_document(current_setting('solo.revoked_token'));
  if v_rows <> 0 then raise exception 'a revoked link still opened'; end if;

  -- token ที่ถูกแก้หนึ่งตัวอักษร และ token ที่แต่งขึ้นเอง ต้องล้มแบบปิด ไม่ใช่คืนเอกสารใบอื่น
  select count(*) into v_rows from public.read_shared_document(
    overlay(v_live placing case when left(v_live, 1) = 'a' then 'b' else 'a' end from 1 for 1));
  if v_rows <> 0 then raise exception 'a tampered token opened a document'; end if;
  select count(*) into v_rows from public.read_shared_document('AAAAAAAAAAAAAAAAAAAAAA');
  if v_rows <> 0 then raise exception 'a guessed token opened a document'; end if;
  select count(*) into v_rows from public.read_shared_document('');
  if v_rows <> 0 then raise exception 'an empty token opened a document'; end if;
  select count(*) into v_rows from public.read_shared_document(null);
  if v_rows <> 0 then raise exception 'a null token opened a document'; end if;
end $$;
reset role;

-- ลิงก์ที่หมดอายุปิดตัวเองโดยไม่ต้องมีใครกดเพิกถอน
update public.shared_documents set expires_at = now() - interval '1 minute' where cipher = 'cipher-live';
set role anon;
do $$
declare v_rows integer;
begin
  select count(*) into v_rows from public.read_shared_document(current_setting('solo.live_token'));
  if v_rows <> 0 then raise exception 'an expired link still opened'; end if;
end $$;
reset role;
update public.shared_documents set expires_at = now() + interval '90 days' where cipher = 'cipher-live';

-- ครูอีกคนมองไม่เห็นและเพิกถอนของคนอื่นไม่ได้ แม้จะรู้ token
set role authenticated;
select set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000002', false);
do $$
begin
  if (select count(*) from public.shared_documents) <> 0 then
    raise exception 'row level security exposed another teacher''s shared documents';
  end if;
  if public.revoke_shared_document(current_setting('solo.live_token')) then
    raise exception 'another teacher revoked a document they cannot see';
  end if;
end $$;
reset role;

set role anon;
do $$
declare v_rows integer;
begin
  select count(*) into v_rows from public.read_shared_document(current_setting('solo.live_token'));
  if v_rows <> 1 then raise exception 'a failed cross tenant revoke changed the owner''s link'; end if;
end $$;
reset role;

-- ลบบัญชีครู = ลิงก์ทุกใบของครูคนนั้นหยุดเปิดทันที
do $$
begin
  if (select count(*) from public.shared_documents
      where provider_id = 'd3000000-0000-4000-8000-000000000001') <> 4 then
    raise exception 'fixture did not leave four documents to erase';
  end if;
end $$;
delete from auth.users where id = 'd3000000-0000-4000-8000-000000000001';
set role anon;
do $$
declare v_rows integer;
begin
  select count(*) into v_rows from public.read_shared_document(current_setting('solo.live_token'));
  if v_rows <> 0 then raise exception 'links survived the erasure of the teacher who made them'; end if;
end $$;
reset role;

-- เก็บกวาด: ลบเฉพาะที่หมดอายุนานแล้วหรือถูกเพิกถอนนานแล้ว ของที่ยังมีความหมายต้องอยู่ต่อ
insert into auth.users(id) values ('d3000000-0000-4000-8000-000000000003');
insert into public.shared_documents (token, provider_id, kind, cipher, iv, expires_at, revoked_at, created_at)
values
  ('cleanupAAAAAAAAAAAAAAA', 'd3000000-0000-4000-8000-000000000003', 'invoice', 'c', 'iv',
   now() - interval '30 days', null, now() - interval '120 days'),
  ('cleanupBBBBBBBBBBBBBBB', 'd3000000-0000-4000-8000-000000000003', 'invoice', 'c', 'iv',
   now() + interval '90 days', now() - interval '60 days', now() - interval '90 days'),
  ('cleanupCCCCCCCCCCCCCCC', 'd3000000-0000-4000-8000-000000000003', 'invoice', 'c', 'iv',
   now() + interval '90 days', now() - interval '1 day', now() - interval '2 days'),
  ('cleanupDDDDDDDDDDDDDDD', 'd3000000-0000-4000-8000-000000000003', 'invoice', 'c', 'iv',
   now() + interval '90 days', null, now());
set role service_role;
do $$
begin
  if public.cleanup_shared_documents() <> 2 then
    raise exception 'cleanup removed the wrong number of shared documents';
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.shared_documents
      where provider_id = 'd3000000-0000-4000-8000-000000000003') <> 2 then
    raise exception 'cleanup deleted a link that a parent or teacher still needs';
  end if;
  if not exists (select 1 from public.shared_documents where token = 'cleanupCCCCCCCCCCCCCCC') then
    raise exception 'cleanup removed a recently revoked link before the teacher could see why';
  end if;
  if not exists (select 1 from public.shared_documents where token = 'cleanupDDDDDDDDDDDDDDD') then
    raise exception 'cleanup removed a link that has not expired';
  end if;
end $$;

delete from auth.users where id in (
  'd3000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000003');
