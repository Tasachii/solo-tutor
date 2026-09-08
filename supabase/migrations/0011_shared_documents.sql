-- เอกสารที่ครูแชร์ให้ผู้ปกครอง: เซิร์ฟเวอร์เก็บแต่ ciphertext กุญแจอยู่หลัง # ของลิงก์เท่านั้น
-- จึงไม่เคยเดินทางมาถึงเซิร์ฟเวอร์ ทั้งใน log และใน Referer · เซิร์ฟเวอร์อ่านชื่อเด็ก ยอดเงิน
-- หรือเลขพร้อมเพย์ไม่ได้เลย สิ่งที่เซิร์ฟเวอร์ทำได้คือหยุดจ่าย ciphertext ก้อนนั้นเมื่อหมดอายุหรือถูกเพิกถอน
--
-- ขอบเขตที่ทำได้จริง: เพิกถอน = ปิดการเปิดครั้งต่อไป ไม่ใช่การลบสำเนาที่ผู้รับเปิดหรือบันทึกไปแล้ว

create table public.shared_documents (
  -- 16 ไบต์สุ่มจากเซิร์ฟเวอร์ เข้ารหัสเป็น base64url — เดาไม่ได้ และไม่ผูกกับ id ของบิลใบไหน
  token text primary key check (token ~ '^[A-Za-z0-9_-]{22}$'),
  provider_id uuid not null references public.providers(id) on delete cascade,
  kind text not null check (kind in ('invoice', 'receipt')),
  -- base64 ของ AES-GCM-256 · 64000 ตัวอักษร ≈ 48 KB ของ JSON เอกสารหนึ่งใบ
  cipher text not null check (length(cipher) between 1 and 64000),
  iv text not null check (length(iv) between 1 and 64),
  -- ป้ายชื่อสำหรับให้ครูจำได้ว่าใบไหน เข้ารหัสด้วยกุญแจคลาวด์ของครูเอง เซิร์ฟเวอร์อ่านไม่ออกเช่นกัน
  label text check (label is null or length(label) between 1 and 2000),
  label_iv text check (label_iv is null or length(label_iv) between 1 and 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint shared_documents_label_pair_check check ((label is null) = (label_iv is null))
);
alter table public.shared_documents enable row level security;

-- ครูเห็นเฉพาะแถวของตัวเอง — การเดา token หรือ id ของครูคนอื่นผ่าน REST จึงคืนศูนย์แถวเสมอ
create policy shared_documents_read_own on public.shared_documents
  for select using (provider_id = auth.uid());
revoke all on public.shared_documents from public, anon, authenticated;
grant all on public.shared_documents to service_role;
grant select on public.shared_documents to authenticated;

create index shared_documents_provider_idx on public.shared_documents (provider_id, created_at desc);
create index shared_documents_expiry_idx on public.shared_documents (expires_at);

-- ครูเผยแพร่เอกสารของตัวเองเท่านั้น · เซิร์ฟเวอร์เป็นผู้ออก token ไม่ใช่ client
-- อายุลิงก์ถูกบีบให้อยู่ในกรอบเสมอ client จะขอ "ไม่มีวันหมดอายุ" ไม่ได้
create function public.publish_shared_document(
  p_kind text, p_cipher text, p_iv text, p_expires_at timestamptz,
  p_label text default null, p_label_iv text default null
) returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid := auth.uid();
  v_expires timestamptz;
  v_live integer;
  v_token text;
begin
  if v_provider_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_kind not in ('invoice', 'receipt') then
    raise exception 'unknown document kind' using errcode = '22023';
  end if;
  if p_cipher is null or length(p_cipher) < 1 or length(p_cipher) > 64000
     or p_iv is null or length(p_iv) < 1 or length(p_iv) > 64 then
    raise exception 'invalid document payload' using errcode = '22023';
  end if;
  if (p_label is null) <> (p_label_iv is null) then
    raise exception 'invalid document label' using errcode = '22023';
  end if;

  v_expires := least(
    greatest(coalesce(p_expires_at, now() + interval '90 days'), now() + interval '1 hour'),
    now() + interval '180 days'
  );

  -- เพดานต่อครู กันบัญชีที่ถูกยึดไปเขียนฐานจนเต็ม · นับเฉพาะลิงก์ที่ยังเปิดได้
  select count(*) into v_live from public.shared_documents d
    where d.provider_id = v_provider_id and d.revoked_at is null and d.expires_at > now();
  if v_live >= 5000 then
    raise exception 'too many active shared documents' using errcode = '54000';
  end if;

  loop
    -- uuid v4 = สุ่ม 122 บิต และเป็นของ pg_catalog จึงไม่ต้องพึ่ง pgcrypto ที่อยู่คนละ schema
    -- 16 ไบต์ → base64 24 ตัว → ตัด '=' สองตัวออกเหลือ 22 ตัวแบบ base64url
    v_token := translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/=', '-_');
    begin
      insert into public.shared_documents (token, provider_id, kind, cipher, iv, label, label_iv, expires_at)
      values (v_token, v_provider_id, p_kind, p_cipher, p_iv, p_label, p_label_iv, v_expires);
      exit;
    exception when unique_violation then
      -- 128 บิตชนกันแทบเป็นไปไม่ได้ วนใหม่แทนที่จะคืน error ให้ครู
    end;
  end loop;

  return query select v_token, v_expires;
end $$;
revoke all on function public.publish_shared_document(text, text, text, timestamptz, text, text)
  from public, anon;
grant execute on function public.publish_shared_document(text, text, text, timestamptz, text, text)
  to authenticated;

-- ทางเดียวที่คนนอกเข้าถึงเอกสารได้ · คืนศูนย์แถวเมื่อถูกเพิกถอนหรือหมดอายุ จึงล้มแบบปิดเสมอ
-- ไม่คืน provider_id, created_at หรืออะไรที่บอกว่าเอกสารนี้เป็นของครูคนไหน
create function public.read_shared_document(p_token text)
returns table (kind text, cipher text, iv text, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.kind, d.cipher, d.iv, d.expires_at
  from public.shared_documents d
  where d.token = p_token
    and d.revoked_at is null
    and d.expires_at > now()
$$;
revoke all on function public.read_shared_document(text) from public;
grant execute on function public.read_shared_document(text) to anon, authenticated;

-- เพิกถอน = หยุดจ่าย ciphertext ให้การเปิดครั้งต่อไป ไม่ใช่การลบสำเนาที่ผู้รับถือไว้แล้ว
-- คืน false เมื่อไม่มีแถวนั้นหรือเพิกถอนไปแล้ว ครูจะได้ไม่เข้าใจว่ากดสำเร็จทั้งที่ไม่มีอะไรเปลี่ยน
create function public.revoke_shared_document(p_token text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid := auth.uid();
  v_updated integer;
begin
  if v_provider_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  update public.shared_documents d set revoked_at = now()
    where d.token = p_token and d.provider_id = v_provider_id and d.revoked_at is null;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end $$;
revoke all on function public.revoke_shared_document(text) from public, anon;
grant execute on function public.revoke_shared_document(text) to authenticated;

-- เก็บกวาดของที่หมดอายุ ไม่ให้ ciphertext ค้างในฐานนานกว่าที่ลิงก์มีความหมาย
-- เก็บที่เพิกถอนไว้ 30 วันเพื่อให้ยังตอบครูได้ว่าใบนั้นถูกปิดแล้วจริง
create function public.cleanup_shared_documents() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted bigint;
begin
  delete from public.shared_documents
    where expires_at < now() - interval '7 days'
       or revoked_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.cleanup_shared_documents() from public, anon, authenticated;
grant execute on function public.cleanup_shared_documents() to service_role;

comment on table public.shared_documents is
  'Ciphertext only. The decryption key lives in the URL fragment and never reaches this database.';
comment on column public.shared_documents.revoked_at is
  'Blocks future reads. Copies already opened or saved by a recipient are outside this system.';
