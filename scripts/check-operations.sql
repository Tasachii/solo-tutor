\set ON_ERROR_STOP on
-- Read-only hourly health thresholds. Output contains counts only, never error text,
-- teacher identity, student data, message bodies, or payment notes.
begin transaction read only;

select
  count(*) filter (where created_at >= now() - interval '1 hour') as recent_client_errors
from public.client_errors;

select
  count(*) filter (where status = 'pending' and created_at < now() - interval '24 hours') as stale_plan_requests
from public.plan_requests;

select
  count(*) filter (where status = 'manual_review') as manual_review_outbox,
  count(*) filter (
    where status = 'processing' and claimed_at < now() - interval '15 minutes'
  ) as stale_processing_outbox,
  count(*) filter (
    where status = 'queued' and scheduled_at < now() - interval '1 hour'
  ) as stale_queued_outbox
from public.message_outbox;

do $$
declare
  v_recent_errors bigint;
  v_stale_plans bigint;
  v_manual_review bigint;
  v_stale_processing bigint;
  v_stale_queued bigint;
begin
  select count(*) into v_recent_errors from public.client_errors
    where created_at >= now() - interval '1 hour';
  select count(*) into v_stale_plans from public.plan_requests
    where status = 'pending' and created_at < now() - interval '24 hours';
  select
    count(*) filter (where status = 'manual_review'),
    count(*) filter (where status = 'processing' and claimed_at < now() - interval '15 minutes'),
    count(*) filter (where status = 'queued' and scheduled_at < now() - interval '1 hour')
  into v_manual_review, v_stale_processing, v_stale_queued
  from public.message_outbox;

  if v_recent_errors + v_stale_plans + v_manual_review + v_stale_processing + v_stale_queued > 0 then
    raise exception 'operations thresholds exceeded'
      using detail = format(
        'recent_errors=%s stale_plans=%s manual_review=%s stale_processing=%s stale_queued=%s',
        v_recent_errors, v_stale_plans, v_manual_review, v_stale_processing, v_stale_queued
      );
  end if;
end $$;

commit;
