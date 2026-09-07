-- ตัวนับการใช้งานแบบไม่ระบุตัวตน: teacher_id เป็น uuid สุ่มในเครื่องครู ไม่ผูกกับบัญชี ไม่มีชื่อเด็ก/ชื่อครู/ยอดเงิน
create table public.usage_events (
  id bigint generated always as identity primary key,
  teacher_id uuid not null,
  event text not null check (event in ('app_open', 'students_changed', 'invoice_issued', 'payment_recorded')),
  count integer not null default 1 check (count >= 0 and count <= 10000),
  mode text check (mode in ('demo', 'real') or mode is null),
  at timestamptz not null default now()
);
alter table public.usage_events enable row level security;
revoke all on public.usage_events from public, anon, authenticated;
grant all on public.usage_events to service_role;
create index usage_events_at_idx on public.usage_events (at desc);
create index usage_events_teacher_idx on public.usage_events (teacher_id, at desc);

-- มุมมองสรุปให้ทีมอ่านง่าย: ครูที่ใช้จริงกี่คน ออกบิลกี่ใบ รับเงินกี่ครั้ง ต่อวัน
create view public.usage_daily as
select date_trunc('day', at at time zone 'Asia/Bangkok')::date as day,
       mode,
       count(distinct teacher_id) filter (where event = 'app_open') as teachers_opened,
       sum(count) filter (where event = 'invoice_issued') as invoices_issued,
       sum(count) filter (where event = 'payment_recorded') as payments_recorded,
       max(count) filter (where event = 'students_changed') as max_students_seen
from public.usage_events group by 1, 2 order by 1 desc;
revoke all on public.usage_daily from public, anon, authenticated;
grant select on public.usage_daily to service_role;
