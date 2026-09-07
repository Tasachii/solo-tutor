-- แพ็กสมาชิกของครู: free (สูงสุด 5 นักเรียน) หรือ pro จนถึงวันที่กำหนด · พักได้ (หยุดนับวัน) ตามที่หน้าราคาสัญญา
-- Solo ไม่ถือเงิน: ครูแจ้งขอเปิด Pro → ทีมตรวจการโอนแล้วอนุมัติด้วยมือผ่านฟังก์ชัน service_role · ไม่มีการตัดบัตร

alter table public.providers
  add column plan text not null default 'free' check (plan in ('free', 'pro')),
  add column plan_until date,
  add column paused_at timestamptz;
grant select (id, created_at, plan, plan_until, paused_at) on public.providers to authenticated;

create table public.plan_requests (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  months integer not null check (months in (1, 3, 12)),
  amount integer not null check (amount > 0),
  note text check (note is null or length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  receipt_no text unique
);
create index plan_requests_provider_idx on public.plan_requests (provider_id, created_at desc);
alter table public.plan_requests enable row level security;
create policy plan_requests_read_own on public.plan_requests for select using (provider_id = auth.uid());
revoke all on public.plan_requests from public, anon, authenticated;
grant all on public.plan_requests to service_role;
grant select on public.plan_requests to authenticated;

-- วันของครูคือวันไทย — public.thai_today() ของเซิร์ฟเวอร์เป็น UTC ซึ่งช้ากว่า 7 ชั่วโมง เที่ยงคืนถึงตีเจ็ดจะผิดวัน
create function public.thai_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

-- ราคาอยู่ฝั่งเซิร์ฟเวอร์ — client บอกแค่จำนวนเดือน ยอดจึงปลอมไม่ได้ (ตรงกับ src/platform/plans.ts)
create function public.plan_price(p_months integer) returns integer
language sql immutable as $$
  select case p_months when 1 then 299 when 3 then 799 when 12 then 2490 end
$$;

create function public.request_plan(p_months integer, p_note text)
returns table (id uuid, months integer, amount integer, status text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid := auth.uid();
  v_amount integer := public.plan_price(p_months);
begin
  if v_provider_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if v_amount is null then raise exception 'unknown plan' using errcode = '22023'; end if;
  if exists (select 1 from public.plan_requests r where r.provider_id = v_provider_id and r.status = 'pending') then
    raise exception 'request already pending' using errcode = '23505';
  end if;
  return query insert into public.plan_requests as r (provider_id, months, amount, note)
    values (v_provider_id, p_months, v_amount, nullif(btrim(coalesce(p_note, '')), ''))
    returning r.id, r.months, r.amount, r.status, r.created_at;
end $$;
revoke all on function public.request_plan(integer, text) from public, anon;
grant execute on function public.request_plan(integer, text) to authenticated;

-- ครูยกเลิกคำขอที่ยังรออยู่ได้เอง (เช่น กดผิดแพ็ก)
create function public.cancel_plan_request() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  delete from public.plan_requests where provider_id = auth.uid() and status = 'pending';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.cancel_plan_request() from public, anon;
grant execute on function public.cancel_plan_request() to authenticated;

-- พัก/เลิกพัก: วันที่เหลือหยุดนับระหว่างพัก แล้วเลื่อนวันหมดอายุออกไปเท่าที่พัก
create function public.pause_plan() returns table (plan text, plan_until date, paused_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  update public.providers p set paused_at = now()
    where p.id = auth.uid() and p.plan = 'pro' and p.paused_at is null and p.plan_until >= public.thai_today();
  return query select p.plan, p.plan_until, p.paused_at from public.providers p where p.id = auth.uid();
end $$;
create function public.resume_plan() returns table (plan text, plan_until date, paused_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  update public.providers p
    set plan_until = p.plan_until + greatest(0, (public.thai_today() - (p.paused_at at time zone 'Asia/Bangkok')::date)),
        paused_at = null
    where p.id = auth.uid() and p.paused_at is not null;
  return query select p.plan, p.plan_until, p.paused_at from public.providers p where p.id = auth.uid();
end $$;
revoke all on function public.pause_plan() from public, anon;
revoke all on function public.resume_plan() from public, anon;
grant execute on function public.pause_plan() to authenticated;
grant execute on function public.resume_plan() to authenticated;

-- ทีมอนุมัติหลังเห็นยอดโอนจริง (รันใน SQL editor ด้วย service_role) — ต่อจากวันหมดอายุเดิมถ้ายังไม่หมด
create function public.approve_plan_request(p_request_id uuid)
returns table (provider_id uuid, plan text, plan_until date, receipt_no text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.plan_requests%rowtype;
  v_no text;
begin
  select * into v_req from public.plan_requests r where r.id = p_request_id and r.status = 'pending' for update;
  if v_req.id is null then raise exception 'no pending request' using errcode = '22023'; end if;
  v_no := 'SP-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMM') || '-' || lpad(
    (select count(*) + 1 from public.plan_requests r where r.status = 'approved'
      and date_trunc('month', r.decided_at at time zone 'Asia/Bangkok') = date_trunc('month', now() at time zone 'Asia/Bangkok'))::text, 4, '0');
  update public.plan_requests r set status = 'approved', decided_at = now(), receipt_no = v_no where r.id = v_req.id;
  update public.providers p
    set plan = 'pro',
        plan_until = (greatest(coalesce(p.plan_until, public.thai_today() - 1), public.thai_today() - 1) + 1 + (v_req.months * interval '1 month'))::date - 1,
        paused_at = null
    where p.id = v_req.provider_id;
  return query select p.id, p.plan, p.plan_until, v_no from public.providers p where p.id = v_req.provider_id;
end $$;
create function public.reject_plan_request(p_request_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  update public.plan_requests r set status = 'rejected', decided_at = now() where r.id = p_request_id and r.status = 'pending';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.approve_plan_request(uuid) from public, anon, authenticated;
revoke all on function public.reject_plan_request(uuid) from public, anon, authenticated;
grant execute on function public.approve_plan_request(uuid) to service_role;
grant execute on function public.reject_plan_request(uuid) to service_role;
