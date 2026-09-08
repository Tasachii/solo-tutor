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

-- แฮชต้องเป็น hex 64 ตัวเสมอ ไม่งั้นตัวจำกัดจะปฏิเสธอาร์กิวเมนต์
do $$
declare v_hash text;
begin
  v_hash := public.public_client_hash();
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'client hash has the wrong shape: %', v_hash;
  end if;
  -- เรียกซ้ำในผู้เรียกเดียวกันต้องได้ค่าเดิม ไม่งั้นการนับต่อผู้เรียกจะไม่มีความหมาย
  if v_hash <> public.public_client_hash() then
    raise exception 'client hash is not stable for the same caller';
  end if;
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
do $$
declare
  v_blocked boolean := false;
  i integer;
begin
  for i in 1..80 loop
    begin
      perform * from public.read_shared_document('RATELIMITTOKEN00000000');
    exception when others then
      if sqlstate = '53400' then v_blocked := true; exit; end if;
      raise;
    end;
  end loop;
  if not v_blocked then
    raise exception 'reading the same document 80 times in a minute was never rate limited';
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
