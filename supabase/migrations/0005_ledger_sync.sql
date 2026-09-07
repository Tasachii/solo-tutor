-- สำรองสมุดบัญชีขึ้นคลาวด์: หนึ่งแถวต่อครู เก็บเฉพาะ ciphertext ที่เข้ารหัสบนเครื่องครูด้วยรหัสผ่านของครู
-- เซิร์ฟเวอร์ไม่มีกุญแจ จึงอ่านชื่อนักเรียน/ยอดเงินไม่ได้ · revision ต้องเดินหน้าเสมอ กันสองเครื่องเขียนทับกัน

create table public.ledger_snapshots (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  revision bigint not null check (revision > 0),
  schema_version integer not null check (schema_version > 0),
  -- base64 ของ AES-GCM · 4 ล้านตัวอักษร ≈ 3 MB ข้อมูลจริง — ครูคนเดียวใช้ไม่ถึงหนึ่งในสิบ
  cipher text not null check (length(cipher) between 1 and 4000000),
  iv text not null check (length(iv) between 1 and 64),
  kdf text not null check (length(kdf) <= 64),
  device text check (device is null or length(device) <= 80),
  updated_at timestamptz not null default now()
);
alter table public.ledger_snapshots enable row level security;
create policy ledger_snapshots_read_own on public.ledger_snapshots
  for select using (provider_id = auth.uid());
revoke all on public.ledger_snapshots from public, anon, authenticated;
grant all on public.ledger_snapshots to service_role;
grant select on public.ledger_snapshots to authenticated;

-- เขียนผ่านฟังก์ชันเท่านั้น เพื่อบังคับเช็ค revision ที่เครื่องเห็นล่าสุด (optimistic lock)
-- คืน ok=false พร้อม revision ปัจจุบันเมื่อชน — ไม่ raise เพื่อให้ client แยก "ชน" จาก "พัง" ได้ชัด
create function public.save_ledger_snapshot(
  p_expected_revision bigint, p_revision bigint, p_schema_version integer,
  p_cipher text, p_iv text, p_kdf text, p_device text
) returns table (ok boolean, revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid := auth.uid();
  v_current bigint;
begin
  if v_provider_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_revision is null or p_revision <= p_expected_revision then
    raise exception 'invalid revision' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger:' || v_provider_id::text, 0));
  select s.revision into v_current from public.ledger_snapshots s where s.provider_id = v_provider_id;
  if coalesce(v_current, 0) <> p_expected_revision then
    return query select false, coalesce(v_current, 0)::bigint, null::timestamptz;
    return;
  end if;
  insert into public.ledger_snapshots as s (provider_id, revision, schema_version, cipher, iv, kdf, device)
  values (v_provider_id, p_revision, p_schema_version, p_cipher, p_iv, p_kdf, p_device)
  on conflict (provider_id) do update set
    revision = excluded.revision, schema_version = excluded.schema_version,
    cipher = excluded.cipher, iv = excluded.iv, kdf = excluded.kdf,
    device = excluded.device, updated_at = now();
  return query select true, p_revision, now();
end $$;
revoke all on function public.save_ledger_snapshot(bigint, bigint, integer, text, text, text, text) from public, anon;
grant execute on function public.save_ledger_snapshot(bigint, bigint, integer, text, text, text, text) to authenticated;

-- ครูลบข้อมูลบนคลาวด์ของตัวเองได้ทุกเมื่อ (หน้านโยบายสัญญาไว้)
create function public.delete_ledger_snapshot() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid := auth.uid();
  v_deleted integer;
begin
  if v_provider_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  delete from public.ledger_snapshots where provider_id = v_provider_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end $$;
revoke all on function public.delete_ledger_snapshot() from public, anon;
grant execute on function public.delete_ledger_snapshot() to authenticated;
