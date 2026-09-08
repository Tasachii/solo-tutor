-- J-11 · จำกัดอัตราการเปิดลิงก์เอกสารของผู้ปกครอง
--
-- `read_shared_document` เปิดให้ anon เรียกได้ตามตั้งใจ เพราะผู้ปกครองไม่ต้องมีบัญชี
-- token เป็นของสุ่ม 122 บิตจึงเดาไม่ไหว แต่ "เดาไม่ไหว" กับ "ยิงเท่าไหร่ก็ได้" เป็นคนละเรื่อง
-- ไม่มีอะไรกันคนที่ยิงรัวเพื่อไล่หา token หรือเพื่อถล่มโควตาของโปรเจกต์ฟรี
-- ตัวจำกัดเดิม (`take_public_rate_limit`) ทำงานผ่าน Edge Function เท่านั้น ส่วนนี้เรียก PostgREST ตรง
--
-- แนวทาง: นับต่อผู้เรียกด้วยแฮชของหมายเลขเครือข่าย + ความลับที่อยู่ในฐาน แล้วมีเพดานรวมกันทั้งระบบอีกชั้น
-- **ไม่เก็บหมายเลขเครือข่ายดิบ** และแฮชย้อนกลับไม่ได้ถ้าไม่มีความลับ ซึ่ง anon อ่านไม่ได้
-- ผู้เรียกที่ไม่มีหมายเลขเครือข่ายให้ดู (เช่นเรียกจากในฐานเอง) นับรวมอยู่ในถังเดียวกันชื่อ __noaddr__

create extension if not exists pgcrypto;

-- ความลับสำหรับแฮช สร้างครั้งเดียวตอน migrate และไม่มีใครนอกจาก service_role อ่านได้
-- อยู่ในฐานแทนที่จะอยู่ในโค้ด เพราะโค้ดอยู่ใน repo สาธารณะ
create table if not exists public.rate_limit_salt (
  only_row boolean primary key default true check (only_row),
  salt text not null,
  created_at timestamptz not null default now()
);
alter table public.rate_limit_salt enable row level security;
revoke all on public.rate_limit_salt from public, anon, authenticated;
grant select on public.rate_limit_salt to service_role;
insert into public.rate_limit_salt (only_row, salt)
values (true, encode(gen_random_bytes(32), 'hex'))
on conflict (only_row) do nothing;

-- ตารางมีรายชื่อปลายทางของตัวเองด้วย ต้องขยายทั้งสองที่ ไม่งั้นฟังก์ชันยอมแต่ตารางปฏิเสธ
alter table public.public_rate_limits drop constraint if exists public_rate_limits_endpoint_check;
alter table public.public_rate_limits add constraint public_rate_limits_endpoint_check
  check (endpoint in ('waitlist', 'report-error', 'usage', 'delete-account', 'shared-document'));

-- ตัวจำกัดเดิมรับเฉพาะสี่ปลายทาง เพิ่มปลายทางนี้เข้าไปโดยไม่แตะตรรกะการนับ
create or replace function public.take_public_rate_limit(
  p_endpoint text,
  p_client_hash text,
  p_client_limit integer,
  p_global_limit integer,
  p_window_seconds integer
) returns table (allowed boolean, retry_after integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval;
  v_global public.public_rate_limits%rowtype;
  v_client public.public_rate_limits%rowtype;
begin
  if p_endpoint not in ('waitlist', 'report-error', 'usage', 'delete-account', 'shared-document')
     or p_client_hash !~ '^[0-9a-f]{64}$'
     or p_client_limit < 1 or p_global_limit < p_client_limit
     or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'invalid rate-limit arguments' using errcode = '22023';
  end if;
  v_window := make_interval(secs => p_window_seconds);

  -- Always lock global before client so concurrent callers cannot deadlock.
  insert into public.public_rate_limits as l (endpoint, client_hash, window_started, attempts)
  values (p_endpoint, '__global__', v_now, 1)
  on conflict (endpoint, client_hash) do update set
    attempts = case when l.window_started <= v_now - v_window then 1 else l.attempts + 1 end,
    window_started = case when l.window_started <= v_now - v_window then v_now else l.window_started end
  returning * into v_global;

  -- Once the shared cap is exhausted, do not create a row for every rotating IP.
  -- The one global row still advances atomically and supplies the retry window.
  if v_global.attempts > p_global_limit then
    allowed := false;
    retry_after := greatest(
      ceil(extract(epoch from v_global.window_started + v_window - v_now))::integer,
      1
    );
    return next;
    return;
  end if;

  insert into public.public_rate_limits as l (endpoint, client_hash, window_started, attempts)
  values (p_endpoint, p_client_hash, v_now, 1)
  on conflict (endpoint, client_hash) do update set
    attempts = case when l.window_started <= v_now - v_window then 1 else l.attempts + 1 end,
    window_started = case when l.window_started <= v_now - v_window then v_now else l.window_started end
  returning * into v_client;

  allowed := v_client.attempts <= p_client_limit;
  retry_after := greatest(
    case when v_client.attempts > p_client_limit
      then ceil(extract(epoch from v_client.window_started + v_window - v_now))::integer else 0 end,
    1
  );
  return next;
end $$;
revoke all on function public.take_public_rate_limit(text,text,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.take_public_rate_limit(text,text,integer,integer,integer) to service_role;

-- แฮชผู้เรียกจากหมายเลขเครือข่ายที่ PostgREST ส่งมาใน header + ความลับในฐาน
-- คืนค่าเป็น hex 64 ตัวเสมอ เพื่อให้ผ่านการตรวจรูปแบบของตัวจำกัด
create or replace function public.public_client_hash()
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_headers json;
  v_addr text;
  v_salt text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  -- ตัวแรกใน x-forwarded-for คือผู้เรียกจริง ที่เหลือเป็นพร็อกซีระหว่างทาง
  v_addr := coalesce(
    nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
    nullif(btrim(coalesce(v_headers ->> 'cf-connecting-ip', '')), ''),
    '__noaddr__'
  );
  select salt into v_salt from public.rate_limit_salt where only_row;
  if v_salt is null then
    raise exception 'rate limit salt missing' using errcode = '55000';
  end if;
  return encode(digest(v_addr || ':' || v_salt, 'sha256'), 'hex');
end $$;
revoke all on function public.public_client_hash() from public, anon, authenticated;
grant execute on function public.public_client_hash() to service_role;

-- อ่านเอกสารได้เหมือนเดิม แต่ต้องผ่านตัวจำกัดก่อน
-- 60 ครั้งต่อนาทีต่อผู้เรียก: ผู้ปกครองคนหนึ่งเปิดบิลไม่กี่ครั้ง ส่วนคนที่ไล่หา token จะชนเพดานทันที
-- เพดานรวม 1200 ต่อนาที กันการยิงจากหลายเครือข่ายพร้อมกัน โดยยังกว้างพอสำหรับการใช้งานจริง
-- ต้องเป็น volatile เพราะการนับคือการเขียน ฟังก์ชันเดิมประกาศ stable ไว้ซึ่งใช้กับตัวจำกัดไม่ได้
create or replace function public.read_shared_document(p_token text)
returns table (kind text, cipher text, iv text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_allowed boolean;
begin
  select rl.allowed into v_allowed
  from public.take_public_rate_limit('shared-document', public.public_client_hash(), 60, 1200, 60) rl;
  if not coalesce(v_allowed, false) then
    raise exception 'too many requests' using errcode = '53400';
  end if;

  return query
    select d.kind, d.cipher, d.iv, d.expires_at
    from public.shared_documents d
    where d.token = p_token
      and d.revoked_at is null
      and d.expires_at > now();
end $$;
revoke all on function public.read_shared_document(text) from public;
grant execute on function public.read_shared_document(text) to anon, authenticated;

comment on function public.read_shared_document(text) is
  'ผู้ปกครองเปิดเอกสารโดยไม่ต้องมีบัญชี — จำกัด 60 ครั้ง/นาที/ผู้เรียก และ 1200 ครั้ง/นาทีรวม';
comment on table public.rate_limit_salt is
  'ความลับสำหรับแฮชหมายเลขเครือข่าย — ไม่เก็บหมายเลขดิบ และ anon อ่านตารางนี้ไม่ได้';
