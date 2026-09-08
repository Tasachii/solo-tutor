-- B-05 · ลบข้อมูลผู้ปกครองบนเซิร์ฟเวอร์ตามคำสั่งลบของครู
--
-- ปัญหาเดิม: sync_line_workspace_clients ทำแค่ insert/update เท่านั้น ครูลบผู้จ่ายในเครื่องแล้ว
-- ชื่อผู้จ่าย · การผูก LINE user id · ข้อความที่ผู้ปกครองพิมพ์เข้ามา · เนื้อความที่ส่งออกไป
-- ยังอยู่บนเซิร์ฟเวอร์ต่อไปตลอดกาล ครูเข้าใจว่าลบแล้ว ผู้ปกครองที่ขอให้ลบก็เข้าใจว่าลบแล้ว ทั้งคู่เข้าใจผิด
--
-- **กติกาข้อเดียวที่กำหนดทั้งดีไซน์: "ไม่มีอยู่" ต้องไม่แปลว่า "ถูกลบ"**
-- เครื่องที่ซิงก์สมุดบัญชีรุ่นเก่าซึ่งยังไม่มีผู้จ่ายคนนี้ ต้องลบใครไม่ได้เลยแม้แต่คนเดียว
-- ฟังก์ชันนี้จึงแตะเฉพาะ local_client_key ที่ถูกระบุชื่อมาในคำสั่งเท่านั้น และฝั่งแอปมีทางเดียวที่จะระบุชื่อได้
-- คือใบสั่งลบผู้จ่าย (AppState.deletedClients) ที่เกิดตอนครูกดลบจริง ๆ — ดู src/core/tombstones.ts
--
-- **ยังไม่ deploy** เหมือนไมเกรชัน LINE อื่นในโฟลเดอร์นี้ การลบย้อนกลับไม่ได้
--
-- สิ่งที่การลบหนึ่งครั้งพาไปด้วย และเหตุผล:
--   clients                — ชื่อผู้จ่าย ลบทิ้ง
--   line_workspace_clients — คู่ระหว่างคีย์ในเครื่องกับ client_id พร้อม local_name (ชื่อซ้ำอีกที่) ลบทิ้ง
--   chats                  — ข้อความที่ผู้ปกครองพิมพ์เข้า OA ลบทิ้ง
--   line_link_codes        — รหัสผูกที่ยังไม่ถูกใช้ ลบทิ้ง
--   line_link_attempts     — นับความพยายามผูก ซึ่งเก็บ LINE user id ไว้ตรง ๆ ลบทิ้ง
--   line_recipients        — **ไม่ลบทั้งแถว** แต่ล้างตัวตนออก (ดูเหตุผลด้านล่าง)
--   message_outbox         — **ไม่ลบทั้งแถว** แต่ล้างเนื้อความออก (ดูเหตุผลด้านล่าง)
--
-- ทำไมสองตารางท้ายจึงล้างเนื้อหาแทนการลบแถว:
-- message_outbox มี unique (provider_id, dedupe_key) และนั่นคือสิ่งเดียวที่กันข้อความเดิมถูกส่งซ้ำ
-- ถ้าลบแถวทิ้งวันนี้ พรุ่งนี้เครื่องเก่าที่ยังถือ "เจตนาส่ง" ใบเดิมอยู่จะ enqueue ด้วยคีย์เดิมได้อีก
-- แล้วผู้ปกครองที่เพิ่งขอให้ลบข้อมูลจะได้รับบิลอีกใบ ซึ่งแย่กว่าการเก็บแถวเปล่าไว้มาก
-- จึงเก็บแถวไว้เฉพาะกุญแจกันซ้ำ ทิ้งเนื้อความและข้อความ error ออกให้หมด (เนื้อความคือชื่อเด็กและยอดเงิน)
-- และเพราะ message_outbox อ้าง line_recipients แบบ on delete cascade การเก็บแถว outbox ไว้จึงแปลว่า
-- ต้องเก็บแถว recipient ไว้ด้วย — จึงล้าง line_user_id เป็นค่าสังเคราะห์ ล้างชื่อที่แสดง และตัดสายกับผู้จ่าย
-- ผลคือตัวตนจริงบน LINE หายไป และถ้าผู้ปกครองคนเดิมกดติดตาม OA ใหม่ ระบบจะสร้างแถวใหม่ให้เหมือนคนใหม่
--
-- คิวที่ยังไม่ถูกส่ง (queued) ปิดเป็น skipped ทันที ส่วนแถวที่ worker ถือ claim อยู่ (processing) ไม่แตะ
-- เพราะการแย่งเปลี่ยนสถานะกลางทางทำให้โควตาเพี้ยนและอาจส่งซ้ำ — แทนที่จะแตะ เราตั้ง unfollowed_at
-- ซึ่งเป็นกลไกหยุดส่งเดิมที่ใช้อยู่แล้ว รอบถัดไปที่แถวนั้นถูกหยิบขึ้นมา ตัวส่งจะข้ามเองตามปกติ

create function public.erase_line_workspace_clients(
  p_workspace_key uuid, p_local_client_keys jsonb
)
returns table (local_client_key text, erased boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid := auth.uid();
  v_key text;
  v_client_id uuid;
  v_recipient record;
begin
  if v_provider_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_workspace_key is null or jsonb_typeof(p_local_client_keys) <> 'array' then
    raise exception 'invalid erasure request' using errcode = '22023';
  end if;
  if jsonb_array_length(p_local_client_keys) > 1000 then
    raise exception 'too many erased clients' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_local_client_keys) item
    group by btrim(item) having count(*) > 1
  ) then
    raise exception 'duplicate local client key' using errcode = '22023';
  end if;
  -- ลำดับล็อกเดียวกับ claim/finish/cancel — กันเดดล็อกกับตัวส่งข้อความที่ทำงานอยู่พร้อมกัน
  perform 1 from public.line_channels where provider_id = v_provider_id for update;
  perform pg_advisory_xact_lock(hashtextextended(
    v_provider_id::text || ':' || p_workspace_key::text, 0
  ));

  for v_key in select btrim(item) from jsonb_array_elements_text(p_local_client_keys) item loop
    if coalesce(length(v_key), 0) not between 1 and 200 then
      raise exception 'invalid local client key' using errcode = '22023';
    end if;
    v_client_id := null;
    select m.client_id into v_client_id from public.line_workspace_clients m
    where m.provider_id = v_provider_id and m.workspace_key = p_workspace_key
      and m.local_client_key = v_key
    for update;

    if v_client_id is not null then
      for v_recipient in
        select r.id, r.line_user_id from public.line_recipients r
        where r.provider_id = v_provider_id and r.client_id = v_client_id
        for update
      loop
        -- ตารางนี้อ้าง line_user_id ตรง ๆ จึงต้องไปก่อน ไม่งั้นแก้ค่าในแถว recipient ไม่ได้
        delete from public.line_link_attempts a
        where a.provider_id = v_provider_id and a.line_user_id = v_recipient.line_user_id;

        update public.message_outbox o
        set body = '[erased]', error = null
        where o.provider_id = v_provider_id and o.recipient_id = v_recipient.id;

        update public.message_outbox o
        set status = 'skipped', error = 'client-erased'
        where o.provider_id = v_provider_id and o.recipient_id = v_recipient.id
          and o.status = 'queued';

        update public.line_recipients r
        set client_id = null, display_name = null,
          unfollowed_at = coalesce(r.unfollowed_at, now()),
          line_user_id = 'erased:' || r.id::text
        where r.provider_id = v_provider_id and r.id = v_recipient.id;
      end loop;

      delete from public.chats c
      where c.provider_id = v_provider_id and c.client_id = v_client_id;
      delete from public.line_link_codes k
      where k.provider_id = v_provider_id and k.client_id = v_client_id;
      delete from public.line_workspace_clients m
      where m.provider_id = v_provider_id and m.client_id = v_client_id;
      delete from public.clients c
      where c.provider_id = v_provider_id and c.id = v_client_id;
    end if;

    local_client_key := v_key;
    erased := v_client_id is not null;
    return next;
  end loop;
end $$;

revoke all on function public.erase_line_workspace_clients(uuid, jsonb) from public, anon;
grant execute on function public.erase_line_workspace_clients(uuid, jsonb) to authenticated;
