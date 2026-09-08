-- Paid teachers may erase their account while the minimum issued plan receipt
-- remains for revenue records. The retained row has no provider link or free-text note.
alter table public.plan_requests alter column provider_id drop not null;
alter table public.plan_requests add constraint plan_requests_detached_receipt_check
  check (provider_id is not null or (
    status = 'approved' and receipt_no is not null and decided_at is not null and note is null
  )) not valid;
alter table public.plan_requests validate constraint plan_requests_detached_receipt_check;
comment on column public.plan_requests.provider_id is
  'Null only after account erasure; the approved receipt remains without its provider link.';

create or replace function public.guard_provider_deletion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.plan_requests
    set provider_id = null, note = null
    where provider_id = old.id and status = 'approved';
  delete from public.usage_events where provider_id = old.id;
  return old;
end $$;
revoke all on function public.guard_provider_deletion() from public, anon, authenticated;

-- Lock provider before request, matching provider deletion. This prevents the
-- request->provider / provider->request deadlock and makes approval-vs-delete atomic.
create or replace function public.approve_plan_request(p_request_id uuid)
returns table (provider_id uuid, plan text, plan_until date, receipt_no text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid;
  v_req public.plan_requests%rowtype;
  v_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
  v_sequence integer;
  v_no text;
begin
  select r.provider_id into v_provider_id
    from public.plan_requests r where r.id = p_request_id and r.status = 'pending';
  if v_provider_id is null then raise exception 'no pending request' using errcode = '22023'; end if;
  perform 1 from public.providers p where p.id = v_provider_id for update;
  if not found then raise exception 'provider not found' using errcode = '23503'; end if;
  select * into v_req from public.plan_requests r
    where r.id = p_request_id and r.provider_id = v_provider_id and r.status = 'pending' for update;
  if v_req.id is null then raise exception 'no pending request' using errcode = '22023'; end if;
  insert into public.plan_receipt_counters as c (receipt_month, last_value)
  values (v_month, 1)
  on conflict (receipt_month) do update set last_value = c.last_value + 1
  returning last_value into v_sequence;
  v_no := 'SP-' || to_char(v_month, 'YYYYMM') || '-' ||
    case when v_sequence < 10000 then lpad(v_sequence::text, 4, '0') else v_sequence::text end;
  update public.plan_requests r set status = 'approved', decided_at = now(), receipt_no = v_no where r.id = v_req.id;
  update public.providers p
    set plan = 'pro',
        plan_until = (greatest(coalesce(p.plan_until, public.thai_today() - 1), public.thai_today() - 1) + 1 + (v_req.months * interval '1 month'))::date - 1,
        paused_at = null
    where p.id = v_provider_id;
  return query select p.id, p.plan, p.plan_until, v_no from public.providers p where p.id = v_provider_id;
end $$;
revoke all on function public.approve_plan_request(uuid) from public, anon, authenticated;
grant execute on function public.approve_plan_request(uuid) to service_role;

-- Gross and payment counts remain complete. Identity-based counts intentionally
-- exclude erased accounts; detached_payments makes that limitation visible.
create or replace view public.revenue_monthly as
select date_trunc('month', decided_at at time zone 'Asia/Bangkok')::date as paid_month,
       count(*) as payments,
       count(distinct provider_id) as paying_providers,
       sum(amount)::bigint as gross_baht,
       count(*) filter (where provider_id is null) as detached_payments
from public.plan_requests
where status = 'approved' and decided_at is not null and receipt_no is not null
group by 1;
comment on view public.revenue_monthly is
  'Gross/payment history includes detached receipts; paying_providers and renewal metrics exclude erased accounts.';
revoke all on public.revenue_monthly from public, anon, authenticated;
grant select on public.revenue_monthly to service_role;

create or replace view public.monthly_plan_month2_renewal as
with paid as (
  select r.*,
         row_number() over (partition by provider_id order by decided_at, id) as payment_number
  from public.plan_requests r
  where status = 'approved' and decided_at is not null and receipt_no is not null
    and provider_id is not null
), monthly_cohort as (
  select provider_id,
         date_trunc('month', decided_at at time zone 'Asia/Bangkok')::date as cohort_month
  from paid where payment_number = 1 and months = 1
)
select c.cohort_month,
       count(*) as first_month_payers,
       count(*) filter (where exists (
         select 1 from paid p
         where p.provider_id = c.provider_id and p.payment_number > 1
           and date_trunc('month', p.decided_at at time zone 'Asia/Bangkok')::date
             = (c.cohort_month + interval '1 month')::date
       )) as renewed_in_month_2,
       round(100.0 * count(*) filter (where exists (
         select 1 from paid p
         where p.provider_id = c.provider_id and p.payment_number > 1
           and date_trunc('month', p.decided_at at time zone 'Asia/Bangkok')::date
             = (c.cohort_month + interval '1 month')::date
       )) / nullif(count(*), 0), 1) as renewal_percent
from monthly_cohort c
where (c.cohort_month + interval '2 months')::date
  <= date_trunc('month', now() at time zone 'Asia/Bangkok')::date
group by c.cohort_month;
comment on view public.monthly_plan_month2_renewal is
  'Identity-based cohort metric excludes receipts detached by account erasure.';
revoke all on public.monthly_plan_month2_renewal from public, anon, authenticated;
grant select on public.monthly_plan_month2_renewal to service_role;
