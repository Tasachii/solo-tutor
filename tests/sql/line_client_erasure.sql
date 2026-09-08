\set ON_ERROR_STOP on
begin;

-- ครูสองคน · ครูคนแรกมีผู้จ่ายสองคน (ลบคนเดียว) · ครูคนที่สองใช้คีย์ชื่อเดียวกันเพื่อพิสูจน์การแยก tenant
insert into auth.users(id) values
  ('e5000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000002');

insert into public.line_workspaces(provider_id, workspace_key) values
  ('e5000000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000002');

insert into public.clients(provider_id, id, name) values
  ('e5000000-0000-4000-8000-000000000001', 'e5200000-0000-4000-8000-000000000001', 'แม่ที่ขอให้ลบ'),
  ('e5000000-0000-4000-8000-000000000001', 'e5200000-0000-4000-8000-000000000002', 'แม่ที่ยังเรียนอยู่'),
  ('e5000000-0000-4000-8000-000000000002', 'e5200000-0000-4000-8000-000000000003', 'ผู้จ่ายของครูอีกคน');

insert into public.line_workspace_clients(provider_id, workspace_key, local_client_key, client_id, local_name) values
  ('e5000000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000001', 'cli-erase',
   'e5200000-0000-4000-8000-000000000001', 'แม่ที่ขอให้ลบ'),
  ('e5000000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000001', 'cli-keep',
   'e5200000-0000-4000-8000-000000000002', 'แม่ที่ยังเรียนอยู่'),
  ('e5000000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000002', 'cli-erase',
   'e5200000-0000-4000-8000-000000000003', 'ผู้จ่ายของครูอีกคน');

insert into public.line_recipients(provider_id, id, client_id, line_user_id, display_name, linked_at) values
  ('e5000000-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000001',
   'e5200000-0000-4000-8000-000000000001', 'U-erase-parent', 'แม่ที่ขอให้ลบ', now()),
  ('e5000000-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000002',
   'e5200000-0000-4000-8000-000000000002', 'U-keep-parent', 'แม่ที่ยังเรียนอยู่', now()),
  ('e5000000-0000-4000-8000-000000000002', 'e5300000-0000-4000-8000-000000000003',
   'e5200000-0000-4000-8000-000000000003', 'U-other-tenant', 'ผู้จ่ายของครูอีกคน', now());

insert into public.line_link_attempts(provider_id, line_user_id, attempts) values
  ('e5000000-0000-4000-8000-000000000001', 'U-erase-parent', 2);

insert into public.chats(provider_id, client_id, sender, body) values
  ('e5000000-0000-4000-8000-000000000001', 'e5200000-0000-4000-8000-000000000001', 'client', 'ขอให้ลบข้อมูลลูกด้วยค่ะ'),
  ('e5000000-0000-4000-8000-000000000001', 'e5200000-0000-4000-8000-000000000002', 'client', 'สัปดาห์หน้าเรียนปกติไหมคะ');

insert into public.line_link_codes(provider_id, code, client_id, expires_at) values
  ('e5000000-0000-4000-8000-000000000001', '123123', 'e5200000-0000-4000-8000-000000000001', now() + interval '1 day');

insert into public.message_outbox(provider_id, id, recipient_id, message_id, body, dedupe_key, status, sent_at) values
  ('e5000000-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000001',
   'e5300000-0000-4000-8000-000000000001', 'msg-sent', 'บิลเดือนกันยายน น้องมิ้นท์ 2,000 บาท',
   'ws:invoice:sent', 'sent', now()),
  ('e5000000-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000002',
   'e5300000-0000-4000-8000-000000000001', 'msg-queued', 'ทวงบิลน้องมิ้นท์', 'ws:invoice:queued', 'queued', null),
  ('e5000000-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000004',
   'e5300000-0000-4000-8000-000000000002', 'msg-keep', 'บิลน้องโบว์', 'ws:invoice:keep', 'sent', now());
insert into public.message_outbox(provider_id, id, recipient_id, message_id, body, dedupe_key,
    status, claim_token, claimed_at, first_attempt_at) values
  ('e5000000-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000003',
   'e5300000-0000-4000-8000-000000000001', 'msg-processing', 'บิลที่กำลังส่งอยู่', 'ws:invoice:processing',
   'processing', 'e5500000-0000-4000-8000-000000000001', now(), now());

set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', false);

-- คำสั่งระบุชื่อเฉพาะ cli-erase · cli-keep ไม่ได้ถูกเอ่ยถึง จึงต้องไม่ถูกแตะเลย
create temporary table erase_result as
select * from public.erase_line_workspace_clients(
  'e5100000-0000-4000-8000-000000000001', '["cli-erase"]'::jsonb);
reset role;

do $$
begin
  if (select count(*) from erase_result) <> 1
    or not exists (select 1 from erase_result where local_client_key = 'cli-erase' and erased) then
    raise exception 'erasure did not report the one named client';
  end if;

  -- ตัวตนของผู้จ่ายที่ถูกลบ
  if exists (select 1 from public.clients
      where provider_id = 'e5000000-0000-4000-8000-000000000001'
        and id = 'e5200000-0000-4000-8000-000000000001') then
    raise exception 'erased payer row survived';
  end if;
  if exists (select 1 from public.line_workspace_clients
      where provider_id = 'e5000000-0000-4000-8000-000000000001' and local_client_key = 'cli-erase') then
    raise exception 'erased payer mapping and its stored name survived';
  end if;
  if exists (select 1 from public.chats
      where client_id = 'e5200000-0000-4000-8000-000000000001') then
    raise exception 'inbound parent messages survived erasure';
  end if;
  if exists (select 1 from public.line_link_codes
      where client_id = 'e5200000-0000-4000-8000-000000000001') then
    raise exception 'unused link code survived erasure';
  end if;
  if exists (select 1 from public.line_link_attempts
      where provider_id = 'e5000000-0000-4000-8000-000000000001' and line_user_id = 'U-erase-parent') then
    raise exception 'link attempts kept the parent LINE identity';
  end if;

  -- แถวผู้รับยังอยู่เพื่อค้ำกุญแจกันส่งซ้ำ แต่ตัวตนต้องหายไป
  if exists (select 1 from public.line_recipients where line_user_id = 'U-erase-parent') then
    raise exception 'parent LINE user id survived erasure';
  end if;
  if not exists (select 1 from public.line_recipients r
      where r.id = 'e5300000-0000-4000-8000-000000000001'
        and r.client_id is null and r.display_name is null
        and r.unfollowed_at is not null and r.line_user_id like 'erased:%') then
    raise exception 'erased recipient row was not stripped and stopped';
  end if;
end $$;

do $$
begin
  -- กุญแจกันส่งซ้ำต้องอยู่ครบทุกใบ ไม่งั้นพรุ่งนี้ข้อความเดิมถูกส่งไปหาคนที่เพิ่งขอให้ลบได้อีก
  if (select count(*) from public.message_outbox
      where recipient_id = 'e5300000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'erasure destroyed dedupe keys that block a repeat send';
  end if;
  if exists (select 1 from public.message_outbox
      where recipient_id = 'e5300000-0000-4000-8000-000000000001' and body <> '[erased]') then
    raise exception 'message bodies survived erasure';
  end if;
  -- คิวที่ยังไม่ส่ง ต้องไม่ถูกส่งอีกเลย
  if not exists (select 1 from public.message_outbox
      where id = 'e5400000-0000-4000-8000-000000000002'
        and status = 'skipped' and error = 'client-erased') then
    raise exception 'queued message was left deliverable after erasure';
  end if;
  -- แถวที่ worker ถือ claim อยู่ ห้ามแย่งเปลี่ยนสถานะ — โควตาและการส่งซ้ำจะเพี้ยน
  if not exists (select 1 from public.message_outbox
      where id = 'e5400000-0000-4000-8000-000000000003'
        and status = 'processing' and claim_token = 'e5500000-0000-4000-8000-000000000001') then
    raise exception 'erasure stole an in-flight claim from the sender';
  end if;
end $$;

do $$
begin
  -- ผู้จ่ายที่ไม่ได้ถูกเอ่ยชื่อ ต้องอยู่ครบทุกอย่าง — "ไม่มีอยู่ในคำสั่ง" ไม่เท่ากับ "ถูกลบ"
  if not exists (select 1 from public.clients where id = 'e5200000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.line_workspace_clients
      where provider_id = 'e5000000-0000-4000-8000-000000000001' and local_client_key = 'cli-keep')
    or not exists (select 1 from public.chats where client_id = 'e5200000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.line_recipients
      where id = 'e5300000-0000-4000-8000-000000000002' and line_user_id = 'U-keep-parent'
        and client_id = 'e5200000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.message_outbox
      where id = 'e5400000-0000-4000-8000-000000000004' and body = 'บิลน้องโบว์') then
    raise exception 'erasure touched a payer that was never named';
  end if;
  -- ครูอีกคนที่ใช้คีย์ชื่อเดียวกัน ต้องไม่ถูกแตะ
  if not exists (select 1 from public.clients where id = 'e5200000-0000-4000-8000-000000000003')
    or not exists (select 1 from public.line_recipients where line_user_id = 'U-other-tenant') then
    raise exception 'erasure crossed into another tenant';
  end if;
end $$;

-- เรียกซ้ำต้องปลอดภัยและบอกตรง ๆ ว่าไม่มีอะไรให้ลบแล้ว · คีย์ที่ไม่เคยซิงก์ก็เช่นกัน
set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', false);
create temporary table erase_again as
select * from public.erase_line_workspace_clients(
  'e5100000-0000-4000-8000-000000000001', '["cli-erase", "cli-never-synced"]'::jsonb);
reset role;
do $$
begin
  if exists (select 1 from erase_again where erased) then
    raise exception 'repeat erasure claimed to remove something that was already gone';
  end if;
  if (select count(*) from erase_again) <> 2 then
    raise exception 'repeat erasure did not answer for every named key';
  end if;
  if (select count(*) from public.clients
      where provider_id = 'e5000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'repeat erasure removed more than it was asked to';
  end if;
end $$;

-- ครูคนอื่นสั่งลบด้วย workspace และคีย์ของครูคนแรก ต้องไม่ได้อะไรเลย
set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', false);
create temporary table erase_cross as
select * from public.erase_line_workspace_clients(
  'e5100000-0000-4000-8000-000000000001', '["cli-keep"]'::jsonb);
reset role;
do $$
begin
  if exists (select 1 from erase_cross where erased) then
    raise exception 'one teacher erased another teacher''s payer';
  end if;
  if not exists (select 1 from public.clients where id = 'e5200000-0000-4000-8000-000000000002') then
    raise exception 'cross-tenant erasure removed the owner''s payer';
  end if;
end $$;

-- เครื่องเก่าที่ยังถือเจตนาส่งใบเดิม ต้อง enqueue ไม่ผ่าน ไม่ใช่ส่งซ้ำไปหาคนที่ขอให้ลบ
set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', false);
do $$
begin
  begin
    perform public.enqueue_line_message(
      'e5300000-0000-4000-8000-000000000001', 'msg-sent',
      'บิลเดือนกันยายน น้องมิ้นท์ 2,000 บาท', 'ws:invoice:sent');
    raise exception 'a stale device replayed a message to an erased parent';
  exception when unique_violation then null;
  end;
end $$;
reset role;

-- คำสั่งที่รูปร่างผิด ต้องถูกปฏิเสธ ไม่ใช่ตีความเอาเอง
set role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', false);
do $$
begin
  begin
    perform public.erase_line_workspace_clients(
      'e5100000-0000-4000-8000-000000000001', '"not-an-array"'::jsonb);
    raise exception 'a malformed erasure request was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.erase_line_workspace_clients(
      'e5100000-0000-4000-8000-000000000001', '["dup", "dup"]'::jsonb);
    raise exception 'a duplicated key was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.erase_line_workspace_clients(null, '["cli-keep"]'::jsonb);
    raise exception 'an erasure without a workspace was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- ไม่มีบัญชี = ไม่มีสิทธิ์สั่งลบ
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  begin
    perform public.erase_line_workspace_clients(
      'e5100000-0000-4000-8000-000000000001', '["cli-keep"]'::jsonb);
    raise exception 'unauthenticated erasure was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
