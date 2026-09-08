\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values
  ('d1000000-0000-4000-8000-000000000001'),
  ('d1000000-0000-4000-8000-000000000002'),
  ('d1000000-0000-4000-8000-000000000003');
insert into public.clients(provider_id, name) values
  ('d1000000-0000-4000-8000-000000000001', 'Mock free teacher client'),
  ('d1000000-0000-4000-8000-000000000002', 'Mock paid teacher client'),
  ('d1000000-0000-4000-8000-000000000003', 'Mock failure teacher client');
insert into public.usage_events(teacher_id, provider_id, event, count, mode) values
  ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'app_open', 1, 'real'),
  ('d1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'app_open', 1, 'real');
insert into public.plan_requests(provider_id, months, amount, note, status, decided_at, receipt_no) values
  ('d1000000-0000-4000-8000-000000000002', 1, 299, 'must be erased', 'approved', now(), 'SP-DELETION-TEST'),
  ('d1000000-0000-4000-8000-000000000002', 3, 799, 'pending secret', 'pending', null, null),
  ('d1000000-0000-4000-8000-000000000002', 12, 2490, 'rejected secret', 'rejected', now(), null),
  ('d1000000-0000-4000-8000-000000000003', 1, 299, 'rollback proof', 'approved', now(), 'SP-ROLLBACK-TEST');

do $$
begin
  begin
    insert into public.plan_requests(provider_id, months, amount, status)
      values (null, 1, 299, 'pending');
    raise exception 'non-receipt row was allowed without a provider';
  exception when check_violation then null;
  end;
end $$;

delete from auth.users where id = 'd1000000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd1000000-0000-4000-8000-000000000002';
do $$
begin
  if exists (select 1 from public.providers where id in (
      'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002'))
    or exists (select 1 from public.clients where provider_id in (
      'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002'))
    or exists (select 1 from public.usage_events where teacher_id in (
      'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002')) then
    raise exception 'account deletion left linked operational data';
  end if;
  if (select count(*) from public.plan_requests where receipt_no = 'SP-DELETION-TEST') <> 1 then
    raise exception 'approved receipt was not retained exactly once';
  end if;
  if exists (select 1 from public.plan_requests where receipt_no = 'SP-DELETION-TEST'
      and (provider_id is not null or note is not null or status <> 'approved' or amount <> 299 or months <> 1)) then
    raise exception 'retained receipt contains identity/free text or lost financial fields';
  end if;
  if exists (select 1 from public.plan_requests where note in ('pending secret', 'rejected secret')) then
    raise exception 'non-approved plan requests survived account deletion';
  end if;
  if not exists (select 1 from public.revenue_monthly where gross_baht >= 299 and detached_payments >= 1) then
    raise exception 'detached receipt disappeared from revenue totals';
  end if;
  if has_function_privilege('authenticated', 'public.guard_provider_deletion()', 'execute') then
    raise exception 'deletion trigger is directly callable';
  end if;
end $$;

create function pg_temp.fail_provider_delete() returns trigger language plpgsql as $$
begin raise exception 'synthetic delete failure' using errcode = '23514'; end $$;
create trigger zzz_fail_provider_delete before delete on public.providers
  for each row when (old.id = 'd1000000-0000-4000-8000-000000000003')
  execute function pg_temp.fail_provider_delete();
do $$
begin
  begin
    delete from auth.users where id = 'd1000000-0000-4000-8000-000000000003';
    raise exception 'synthetic failure did not abort deletion';
  exception when check_violation then null;
  end;
  if not exists (select 1 from auth.users where id = 'd1000000-0000-4000-8000-000000000003')
    or not exists (select 1 from public.providers where id = 'd1000000-0000-4000-8000-000000000003')
    or not exists (select 1 from public.clients where provider_id = 'd1000000-0000-4000-8000-000000000003')
    or not exists (select 1 from public.plan_requests where receipt_no = 'SP-ROLLBACK-TEST'
      and provider_id = 'd1000000-0000-4000-8000-000000000003' and note = 'rollback proof') then
    raise exception 'failed deletion was not atomic';
  end if;
end $$;
drop trigger zzz_fail_provider_delete on public.providers;

set role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', false);
do $$ begin
  if exists (select 1 from public.plan_requests where receipt_no = 'SP-DELETION-TEST') then
    raise exception 'detached receipt exposed through RLS';
  end if;
end $$;
reset role;
rollback;
