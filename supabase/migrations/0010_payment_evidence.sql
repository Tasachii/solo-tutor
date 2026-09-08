-- Manual PromptPay operations: only approvals backed by a reconciled bank
-- transaction enter verified pitch revenue. Existing approve_plan_request stays
-- available for compatibility, but its rows remain visibly unverified.

create table public.plan_financial_evidence (
  id uuid primary key default gen_random_uuid(),
  plan_request_id uuid not null references public.plan_requests(id) on delete restrict,
  evidence_type text not null check (evidence_type in ('payment', 'refund')),
  payment_evidence_id uuid references public.plan_financial_evidence(id) on delete restrict,
  bank_reference text not null unique
    check (bank_reference = btrim(bank_reference) and length(bank_reference) between 1 and 128),
  amount integer not null check (amount > 0),
  occurred_at timestamptz not null,
  verified_by text not null check (verified_by = btrim(verified_by) and length(verified_by) between 1 and 120),
  verified_at timestamptz not null default now(),
  check (
    (evidence_type = 'payment' and payment_evidence_id is null)
    or (evidence_type = 'refund' and payment_evidence_id is not null)
  )
);
create unique index plan_financial_evidence_one_payment_idx
  on public.plan_financial_evidence (plan_request_id) where evidence_type = 'payment';
create index plan_financial_evidence_payment_refunds_idx
  on public.plan_financial_evidence (payment_evidence_id, verified_at)
  where evidence_type = 'refund';
alter table public.plan_financial_evidence enable row level security;
revoke all on public.plan_financial_evidence from public, anon, authenticated, service_role;
grant select on public.plan_financial_evidence to service_role;

create function public.prevent_plan_financial_evidence_mutation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'financial evidence is append-only' using errcode = '55000';
end $$;
create trigger plan_financial_evidence_append_only
  before update or delete on public.plan_financial_evidence
  for each row execute function public.prevent_plan_financial_evidence_mutation();
revoke all on function public.prevent_plan_financial_evidence_mutation() from public, anon, authenticated, service_role;

create function public.approve_plan_request_verified(
  p_request_id uuid,
  p_bank_reference text,
  p_received_amount integer,
  p_occurred_at timestamptz,
  p_verified_by text
)
returns table (evidence_id uuid, provider_id uuid, plan text, plan_until date, receipt_no text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_approval record;
  v_expected integer;
  v_evidence_id uuid;
  v_reference text := upper(btrim(coalesce(p_bank_reference, '')));
  v_verifier text := btrim(coalesce(p_verified_by, ''));
begin
  if length(v_reference) not between 1 and 128 then
    raise exception 'bank transaction reference required' using errcode = '22023';
  end if;
  if length(v_verifier) not between 1 and 120 then
    raise exception 'verifier label required' using errcode = '22023';
  end if;
  if p_received_amount is null or p_received_amount <= 0 then
    raise exception 'received amount must be positive' using errcode = '22023';
  end if;
  if p_occurred_at is null or not isfinite(p_occurred_at)
    or p_occurred_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'payment occurrence time is invalid or in the future' using errcode = '22023';
  end if;

  -- The existing provider-first approval owns the locking order. Any validation
  -- or evidence failure below rolls that approval and receipt counter back.
  select * into v_approval from public.approve_plan_request(p_request_id);
  select r.amount into v_expected from public.plan_requests r where r.id = p_request_id;
  if v_expected is null or p_received_amount <> v_expected then
    raise exception 'received amount does not match request amount' using errcode = '22023';
  end if;

  insert into public.plan_financial_evidence (
    plan_request_id, evidence_type, bank_reference, amount, occurred_at, verified_by
  ) values (p_request_id, 'payment', v_reference, p_received_amount, p_occurred_at, v_verifier)
  returning id into v_evidence_id;

  return query select v_evidence_id, v_approval.provider_id, v_approval.plan,
    v_approval.plan_until, v_approval.receipt_no;
end $$;
revoke all on function public.approve_plan_request_verified(uuid, text, integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.approve_plan_request_verified(uuid, text, integer, timestamptz, text) to service_role;

create function public.record_plan_refund(
  p_payment_evidence_id uuid,
  p_bank_reference text,
  p_amount integer,
  p_occurred_at timestamptz,
  p_verified_by text
)
returns table (evidence_id uuid, plan_request_id uuid, refunded_amount integer, total_refunded integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payment public.plan_financial_evidence%rowtype;
  v_total integer;
  v_evidence_id uuid;
  v_reference text := upper(btrim(coalesce(p_bank_reference, '')));
  v_verifier text := btrim(coalesce(p_verified_by, ''));
begin
  if length(v_reference) not between 1 and 128 then
    raise exception 'bank refund reference required' using errcode = '22023';
  end if;
  if length(v_verifier) not between 1 and 120 then
    raise exception 'verifier label required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'refund amount must be positive' using errcode = '22023';
  end if;
  if p_occurred_at is null or not isfinite(p_occurred_at)
    or p_occurred_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'refund occurrence time is invalid or in the future' using errcode = '22023';
  end if;

  select * into v_payment from public.plan_financial_evidence e
    where e.id = p_payment_evidence_id and e.evidence_type = 'payment' for update;
  if v_payment.id is null then raise exception 'verified payment not found' using errcode = '22023'; end if;
  if p_occurred_at < v_payment.occurred_at then
    raise exception 'refund cannot occur before its payment' using errcode = '22023';
  end if;
  select coalesce(sum(e.amount), 0)::integer into v_total
    from public.plan_financial_evidence e
    where e.payment_evidence_id = v_payment.id and e.evidence_type = 'refund';
  if v_total + p_amount > v_payment.amount then
    raise exception 'refund exceeds verified payment' using errcode = '22023';
  end if;

  insert into public.plan_financial_evidence (
    plan_request_id, evidence_type, payment_evidence_id, bank_reference, amount, occurred_at, verified_by
  ) values (
    v_payment.plan_request_id, 'refund', v_payment.id, v_reference, p_amount, p_occurred_at, v_verifier
  ) returning id into v_evidence_id;

  return query select v_evidence_id, v_payment.plan_request_id, p_amount, v_total + p_amount;
end $$;
revoke all on function public.record_plan_refund(uuid, text, integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_plan_refund(uuid, text, integer, timestamptz, text) to service_role;

-- Verified cash movements and legacy approvals are deliberately separate
-- columns. No usage event, demo action, or unverified approval enters gross/net.
create view public.pitch_revenue_monthly as
with verified_cash as (
  select date_trunc('month', e.occurred_at at time zone 'Asia/Bangkok')::date as revenue_month,
         count(*) filter (where e.evidence_type = 'payment') as verified_payments,
         coalesce(sum(e.amount) filter (where e.evidence_type = 'payment'), 0)::bigint as gross_baht,
         coalesce(sum(e.amount) filter (where e.evidence_type = 'refund'), 0)::bigint as refund_baht,
         count(*) filter (where e.evidence_type = 'payment' and r.provider_id is null) as erased_verified_payments
  from public.plan_financial_evidence e
  join public.plan_requests r on r.id = e.plan_request_id
  group by 1
), net_positive_customers as (
  select date_trunc('month', payment.occurred_at at time zone 'Asia/Bangkok')::date as revenue_month,
         count(distinct request.provider_id) as providers
  from public.plan_financial_evidence payment
  join public.plan_requests request on request.id = payment.plan_request_id
  where payment.evidence_type = 'payment' and request.provider_id is not null
    and payment.amount > coalesce((select sum(refund.amount) from public.plan_financial_evidence refund
      where refund.payment_evidence_id = payment.id and refund.evidence_type = 'refund'), 0)
  group by 1
), legacy as (
  select date_trunc('month', r.decided_at at time zone 'Asia/Bangkok')::date as revenue_month,
         count(*) as legacy_unverified_approvals,
         sum(r.amount)::bigint as legacy_unverified_gross_baht
  from public.plan_requests r
  where r.status = 'approved' and r.decided_at is not null
    and not exists (
      select 1 from public.plan_financial_evidence e
      where e.plan_request_id = r.id and e.evidence_type = 'payment'
    )
  group by 1
), months as (
  select revenue_month from verified_cash union select revenue_month from legacy
)
select m.revenue_month,
       coalesce(v.verified_payments, 0) as verified_payments,
       coalesce(c.providers, 0) as verified_net_positive_providers,
       coalesce(v.gross_baht, 0) as verified_gross_baht,
       coalesce(v.refund_baht, 0) as verified_refund_baht,
       coalesce(v.gross_baht, 0) - coalesce(v.refund_baht, 0) as verified_net_baht,
       coalesce(v.erased_verified_payments, 0) as erased_verified_payments,
       coalesce(l.legacy_unverified_approvals, 0) as legacy_unverified_approvals,
       coalesce(l.legacy_unverified_gross_baht, 0) as legacy_unverified_gross_baht
from months m
left join verified_cash v using (revenue_month)
left join net_positive_customers c using (revenue_month)
left join legacy l using (revenue_month);
comment on view public.pitch_revenue_monthly is
  'Pitch revenue uses service-verified bank evidence only. Legacy approved requests are shown separately and excluded from verified gross/net.';
revoke all on public.pitch_revenue_monthly from public, anon, authenticated;
grant select on public.pitch_revenue_monthly to service_role;

create view public.pitch_verified_month2_renewal as
with payment_net as (
  select e.id, r.provider_id, r.months, e.occurred_at,
         e.amount - coalesce((select sum(x.amount) from public.plan_financial_evidence x
           where x.payment_evidence_id = e.id and x.evidence_type = 'refund'), 0) as net_amount
  from public.plan_financial_evidence e
  join public.plan_requests r on r.id = e.plan_request_id
  where e.evidence_type = 'payment' and r.provider_id is not null
), paid as (
  select p.*, row_number() over (partition by provider_id order by occurred_at, id) as payment_number
  from payment_net p where net_amount > 0
), monthly_cohort as (
  select provider_id,
         date_trunc('month', occurred_at at time zone 'Asia/Bangkok')::date as cohort_month
  from paid where payment_number = 1 and months = 1
)
select c.cohort_month,
       count(*) as verified_first_month_payers,
       count(*) filter (where exists (
         select 1 from paid p where p.provider_id = c.provider_id and p.payment_number > 1
           and date_trunc('month', p.occurred_at at time zone 'Asia/Bangkok')::date
             = (c.cohort_month + interval '1 month')::date
       )) as verified_renewed_in_month_2,
       round(100.0 * count(*) filter (where exists (
         select 1 from paid p where p.provider_id = c.provider_id and p.payment_number > 1
           and date_trunc('month', p.occurred_at at time zone 'Asia/Bangkok')::date
             = (c.cohort_month + interval '1 month')::date
       )) / nullif(count(*), 0), 1) as verified_renewal_percent
from monthly_cohort c
where (c.cohort_month + interval '2 months')::date
  <= date_trunc('month', now() at time zone 'Asia/Bangkok')::date
group by c.cohort_month;
comment on view public.pitch_verified_month2_renewal is
  'Verified, net-positive one-month payment cohorts only; erased providers are excluded because identity linkage no longer exists.';
revoke all on public.pitch_verified_month2_renewal from public, anon, authenticated;
grant select on public.pitch_verified_month2_renewal to service_role;
