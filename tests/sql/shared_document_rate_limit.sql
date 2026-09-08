-- J-11 · เปิดเอกสารได้ตามปกติ แต่ยิงรัวไม่ได้
-- ถ้าเทสนี้ล้ม แปลว่าลิงก์ของผู้ปกครองเปิดให้ไล่หา token ได้ไม่จำกัด
\set ON_ERROR_STOP on
begin;

-- ความลับสำหรับแฮชต้องมีจริง และ anon ต้องอ่านไม่ได้
do $$
declare v_salt text;
begin
  select salt into v_salt from public.rate_limit_salt where only_row;
  if v_salt is null or length(v_salt) < 32 then
    raise exception 'rate_limit_salt missing or too short';
  end if;
end $$;

do $$
begin
  set local role anon;
  perform 1 from public.rate_limit_salt;
  reset role;
  raise exception 'anon must not read the hashing secret';
exception
  when insufficient_privilege then reset role;
end $$;

-- ไม่มี header บอกหมายเลขผู้เรียก → คืน null เพื่อให้ไปคุมด้วยเพดานรวมแทน
-- ห้ามคืนค่าคงที่ ไม่งั้นผู้ปกครองทุกคนจะไปเบียดกันในถังเดียวและเปิดบิลไม่ได้
do $$
begin
  if public.public_client_hash() is not null then
    raise exception 'with no forwarding header the caller must not get a shared bucket';
  end if;
end $$;

-- **แกนความปลอดภัย**: ผู้เรียกส่ง x-forwarded-for มาเองได้ พร็อกซีที่เชื่อถือได้จะต่อท้าย
-- ถ้าอ่านตัวแรก ใครก็สลับหมายเลขทุกคำขอเพื่อรีเซ็ตโควตาได้ ตัวจำกัดต่อผู้เรียกจะไร้ความหมาย
do $$
declare
  v_spoof_a text;
  v_spoof_b text;
  v_real_b text;
begin
  perform set_config('request.headers', '{"x-forwarded-for":"1.1.1.1, 203.0.113.9"}', true);
  v_spoof_a := public.public_client_hash();
  if v_spoof_a !~ '^[0-9a-f]{64}$' then
    raise exception 'client hash has the wrong shape: %', v_spoof_a;
  end if;

  -- เปลี่ยนเฉพาะค่าที่ผู้เรียกกรอกเอง — ถังต้องไม่เปลี่ยน
  perform set_config('request.headers', '{"x-forwarded-for":"9.9.9.9, 203.0.113.9"}', true);
  v_spoof_b := public.public_client_hash();
  if v_spoof_b <> v_spoof_a then
    raise exception 'a caller can change its rate-limit bucket by spoofing x-forwarded-for';
  end if;

  -- เปลี่ยนค่าที่พร็อกซีต่อท้าย — ถังต้องเปลี่ยน ไม่งั้นทุกคนใช้ถังเดียวกัน
  perform set_config('request.headers', '{"x-forwarded-for":"1.1.1.1, 198.51.100.7"}', true);
  v_real_b := public.public_client_hash();
  if v_real_b = v_spoof_a then
    raise exception 'different callers share one bucket — per-caller limiting does nothing';
  end if;

  perform set_config('request.headers', '', true);
end $$;

-- เอกสารตัวอย่างหนึ่งใบสำหรับอ่าน — ใช้ครูที่ไฟล์ก่อนหน้าสร้างไว้แล้ว ไม่สร้างบัญชีใหม่
insert into public.shared_documents (token, provider_id, kind, cipher, iv, expires_at)
select 'RATELIMITTOKEN00000000', p.id, 'invoice', 'Y2lwaGVy', 'aXY=', now() + interval '30 days'
from public.providers p order by p.id limit 1;

-- อ่านครั้งแรกต้องได้เอกสาร
do $$
declare v_rows bigint;
begin
  select count(*) into v_rows from public.read_shared_document('RATELIMITTOKEN00000000');
  if v_rows <> 1 then raise exception 'a live document must be readable, got % rows', v_rows; end if;
end $$;

-- ยิงจนเกินเพดานต่อผู้เรียก แล้วต้องถูกปฏิเสธ ไม่ใช่คืนเอกสารต่อไปเรื่อย ๆ
-- ต้องมี header ของพร็อกซีก่อน ไม่งั้นจะตกไปอยู่เส้นทางที่คุมด้วยเพดานรวมซึ่งสูงกว่ามาก
do $$
declare
  v_blocked boolean := false;
  i integer;
begin
  perform set_config('request.headers', '{"x-forwarded-for":"198.51.100.42"}', true);
  for i in 1..80 loop
    begin
      perform * from public.read_shared_document('RATELIMITTOKEN00000000');
    exception when others then
      if sqlstate = '53400' then v_blocked := true; exit; end if;
      raise;
    end;
  end loop;
  perform set_config('request.headers', '', true);
  if not v_blocked then
    raise exception 'reading the same document 80 times in a minute was never rate limited';
  end if;
end $$;

-- ผู้เรียกอีกหมายเลขหนึ่งต้องยังอ่านได้ ถังต้องแยกกันจริง ไม่ใช่ล็อกทุกคนพร้อมกัน
do $$
declare v_rows bigint;
begin
  perform set_config('request.headers', '{"x-forwarded-for":"198.51.100.77"}', true);
  select count(*) into v_rows from public.read_shared_document('RATELIMITTOKEN00000000');
  perform set_config('request.headers', '', true);
  if v_rows <> 1 then
    raise exception 'one caller hitting its limit must not lock out everyone else';
  end if;
end $$;

-- ถูกจำกัดแล้วต้องไม่รั่วข้อมูลออกทางอื่น: token ที่ไม่มีจริงก็ยังไม่คืนแถว
do $$
declare v_rows bigint;
begin
  begin
    select count(*) into v_rows from public.read_shared_document('NOSUCHTOKEN00000000000');
  exception when others then
    if sqlstate = '53400' then v_rows := 0; else raise; end if;
  end;
  if v_rows <> 0 then raise exception 'an unknown token must never return a row'; end if;
end $$;

-- ตัวจำกัดต้องยังปฏิเสธปลายทางที่ไม่อยู่ในรายการ และแฮชผิดรูปแบบ
do $$
begin
  perform public.take_public_rate_limit('not-an-endpoint', repeat('a', 64), 1, 2, 60);
  raise exception 'an unknown endpoint must be rejected';
exception
  when sqlstate '22023' then null;
end $$;

do $$
begin
  perform public.take_public_rate_limit('shared-document', 'not-a-hash', 1, 2, 60);
  raise exception 'a malformed client hash must be rejected';
exception
  when sqlstate '22023' then null;
end $$;

-- anon เรียกตัวจำกัดหรือฟังก์ชันแฮชเองไม่ได้ ต้องผ่านทางฟังก์ชันอ่านเอกสารเท่านั้น
do $$
begin
  set local role anon;
  perform public.public_client_hash();
  reset role;
  raise exception 'anon must not call public_client_hash directly';
exception
  when insufficient_privilege then reset role;
end $$;

rollback;
