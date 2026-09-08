-- Production safety for public intake and paid-plan concurrency.

alter table public.usage_events
  add column provider_id uuid references public.providers(id) on delete set null;
create index usage_events_provider_idx on public.usage_events (provider_id, at desc)
  where provider_id is not null;

-- Fixed-window counters are written only through a service-role RPC. client_hash is
-- SHA-256(endpoint secret + network address); raw network addresses never reach Postgres.
create table public.public_rate_limits (
  endpoint text not null check (endpoint in ('waitlist', 'report-error', 'usage', 'delete-account')),
  client_hash text not null check (client_hash = '__global__' or client_hash ~ '^[0-9a-f]{64}$'),
  window_started timestamptz not null,
  attempts integer not null check (attempts > 0),
  primary key (endpoint, client_hash)
);
alter table public.public_rate_limits enable row level security;
revoke all on public.public_rate_limits from public, anon, authenticated;
grant all on public.public_rate_limits to service_role;

create function public.take_public_rate_limit(
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
  if p_endpoint not in ('waitlist', 'report-error', 'usage', 'delete-account')
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
grant execute on function public.take_public_rate_limit(text,text,integer,integer,integer)
  to service_role;

create function public.cleanup_public_rate_limits() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted bigint;
begin
  delete from public.public_rate_limits where window_started < now() - interval '2 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.cleanup_public_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_public_rate_limits() to service_role;

-- The partial unique index is the final guard even if request_plan changes later.
create unique index plan_requests_one_pending_per_provider_idx
  on public.plan_requests (provider_id) where status = 'pending';

create table public.plan_receipt_counters (
  receipt_month date primary key,
  last_value integer not null check (last_value > 0)
);
alter table public.plan_receipt_counters enable row level security;
revoke all on public.plan_receipt_counters from public, anon, authenticated;
grant all on public.plan_receipt_counters to service_role;

-- Continue after receipts already issued before this migration; never restart at 0001.
insert into public.plan_receipt_counters (receipt_month, last_value)
select date_trunc('month', decided_at at time zone 'Asia/Bangkok')::date,
       max(right(receipt_no, 4)::integer)
from public.plan_requests
where status = 'approved' and decided_at is not null
  and receipt_no ~ '^SP-[0-9]{6}-[0-9]{4}$'
group by 1;

create or replace function public.request_plan(p_months integer, p_note text)
returns table (id uuid, months integer, amount integer, status text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid := auth.uid();
  v_amount integer := public.plan_price(p_months);
begin
  if v_provider_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if v_amount is null then raise exception 'unknown plan' using errcode = '22023'; end if;
  -- Serialize requests for one provider; the unique index remains the invariant.
  perform 1 from public.providers p where p.id = v_provider_id for update;
  if not found then raise exception 'provider not found' using errcode = '23503'; end if;
  if exists (select 1 from public.plan_requests r where r.provider_id = v_provider_id and r.status = 'pending') then
    raise exception 'request already pending' using errcode = '23505';
  end if;
  return query insert into public.plan_requests as r (provider_id, months, amount, note)
    values (v_provider_id, p_months, v_amount, nullif(btrim(coalesce(p_note, '')), ''))
    returning r.id, r.months, r.amount, r.status, r.created_at;
end $$;

create or replace function public.approve_plan_request(p_request_id uuid)
returns table (provider_id uuid, plan text, plan_until date, receipt_no text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.plan_requests%rowtype;
  v_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
  v_sequence integer;
  v_no text;
begin
  select * into v_req from public.plan_requests r where r.id = p_request_id and r.status = 'pending' for update;
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
    where p.id = v_req.provider_id;
  return query select p.id, p.plan, p.plan_until, v_no from public.providers p where p.id = v_req.provider_id;
end $$;

-- Revenue operations use payments actually approved and assigned a receipt.
create view public.revenue_monthly as
select date_trunc('month', decided_at at time zone 'Asia/Bangkok')::date as paid_month,
       count(*) as payments,
       count(distinct provider_id) as paying_providers,
       sum(amount)::bigint as gross_baht
from public.plan_requests
where status = 'approved' and decided_at is not null and receipt_no is not null
group by 1;
revoke all on public.revenue_monthly from public, anon, authenticated;
grant select on public.revenue_monthly to service_role;

-- Month-2 renewal is meaningful only for teachers whose first purchase was monthly.
-- Longer prepaid plans are intentionally excluded rather than mislabeled as churn.
create view public.monthly_plan_month2_renewal as
with paid as (
  select r.*,
         row_number() over (partition by provider_id order by decided_at, id) as payment_number
  from public.plan_requests r
  where status = 'approved' and decided_at is not null and receipt_no is not null
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
revoke all on public.monthly_plan_month2_renewal from public, anon, authenticated;
grant select on public.monthly_plan_month2_renewal to service_role;
