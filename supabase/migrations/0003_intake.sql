-- รับข้อมูลจากคนที่ยังไม่มีบัญชี: รายชื่อจองสิทธิ์รุ่นแรก และ error ที่เกิดบนเครื่องผู้ใช้
-- ทั้งสองตารางเขียนได้จาก service_role ผ่าน Edge Function เท่านั้น anon/authenticated อ่านเขียนไม่ได้เลย

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  profession_id text not null,
  name text not null check (char_length(name) between 1 and 120),
  contact text not null check (char_length(contact) between 1 and 200),
  size text check (size is null or char_length(size) <= 20),
  modes text[] not null default '{}',
  concierge boolean,
  source text not null default 'web',
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;
revoke all on public.waitlist from public, anon, authenticated;
grant all on public.waitlist to service_role;

-- ไม่เก็บชื่อนักเรียนหรือยอดเงิน — client ส่งมาแค่ message/stack/เวอร์ชัน/หน้า
create table public.client_errors (
  id uuid primary key default gen_random_uuid(),
  message text not null check (char_length(message) <= 500),
  stack text check (stack is null or char_length(stack) <= 4000),
  route text check (route is null or char_length(route) <= 200),
  app_version text check (app_version is null or char_length(app_version) <= 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  mode text check (mode in ('demo', 'real') or mode is null),
  created_at timestamptz not null default now()
);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from public, anon, authenticated;
grant all on public.client_errors to service_role;
create index client_errors_created_at_idx on public.client_errors (created_at desc);

-- ปลุกโปรเจกต์ฟรีให้ไม่หลับ (Supabase หยุดโปรเจกต์ที่ไม่มีกิจกรรม 7 วัน) — ต้องแตะฐานข้อมูลจริง
-- ไม่ใช่แค่ชน gateway · anon เรียกได้ คืนค่าคงที่ ไม่แตะตารางไหน
create function public.ping() returns text
language sql stable security invoker set search_path = public as $$ select 'pong'::text $$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
