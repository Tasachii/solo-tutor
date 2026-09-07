\set ON_ERROR_STOP on
-- สัญญาแพ็กสมาชิก: ราคาอยู่เซิร์ฟเวอร์ · ขอซ้ำไม่ได้ · ครูอนุมัติเองไม่ได้ · พักแล้ววันเลื่อน · อนุมัติต่อจากวันเดิม
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
declare r record; v_id uuid;
begin
  select * into r from public.request_plan(3, ' โอนแล้ว 09:41 ');
  if r.amount <> 799 or r.status <> 'pending' then raise exception 'request must price 3 months at 799 and start pending'; end if;
  v_id := r.id;
  begin
    perform public.request_plan(1, null);
    raise exception 'second pending request must be refused';
  exception when sqlstate '23505' then null;
  end;
  begin
    perform public.request_plan(6, null);
    raise exception 'unknown month count must be refused';
  exception when sqlstate '22023' then null;
  end;
  if has_function_privilege('authenticated', 'public.approve_plan_request(uuid)', 'execute') then
    raise exception 'teacher can approve her own plan';
  end if;
  if (select plan from public.providers where id = auth.uid()) <> 'free' then raise exception 'plan changed before approval'; end if;
  -- พักตอนยังฟรี = ไม่มีผล
  select * into r from public.pause_plan();
  if r.paused_at is not null then raise exception 'free plan must not pause'; end if;
end $$;

reset role;
set role service_role;
do $$
declare r record;
begin
  select * into r from public.approve_plan_request((select id from public.plan_requests where status = 'pending'));
  if r.plan <> 'pro' or r.plan_until <> (public.thai_today() + interval '3 month')::date - 1 then
    raise exception 'approval must grant 3 months from today, got %', r.plan_until;
  end if;
  if r.receipt_no !~ '^SP-[0-9]{6}-[0-9]{4}$' then raise exception 'receipt number format %', r.receipt_no; end if;
  -- อนุมัติอีกใบระหว่างยังไม่หมดอายุ = ต่อท้าย ไม่ใช่นับใหม่จากวันนี้
  insert into public.plan_requests(provider_id, months, amount) values ('10000000-0000-0000-0000-000000000001', 1, 299);
  select * into r from public.approve_plan_request((select id from public.plan_requests where status = 'pending'));
  if r.plan_until <> (public.thai_today() + interval '4 month')::date - 1 then
    raise exception 'second approval must extend, got %', r.plan_until;
  end if;
end $$;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
declare r record; v_until date;
begin
  select plan_until into v_until from public.providers where id = auth.uid();
  select * into r from public.pause_plan();
  if r.paused_at is null then raise exception 'pro plan must pause'; end if;
end $$;
reset role;
-- ย้อนเวลาที่พักไว้ 10 วัน (ครูแก้เองไม่ได้ — ทำในฐานะเจ้าของฐานข้อมูล)
update public.providers set paused_at = now() - interval '10 days' where id = '10000000-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
declare r record; v_until date;
begin
  select plan_until into v_until from public.providers where id = auth.uid();
  select * into r from public.resume_plan();
  if r.paused_at is not null or r.plan_until <> v_until + 10 then raise exception 'resume must add paused days, got %', r.plan_until; end if;
  if (select count(*) from public.plan_requests) <> 2 then raise exception 'owner must see her two requests'; end if;
end $$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
do $$
begin
  if (select count(*) from public.plan_requests) <> 0 then raise exception 'RLS exposed another teacher''s plan requests'; end if;
  if (select plan from public.providers where id = '10000000-0000-0000-0000-000000000001') is not null then
    raise exception 'RLS exposed another teacher''s plan';
  end if;
end $$;
reset role;
