-- Run in Supabase SQL Editor with an authorized operations role.
-- These figures never treat app events, demo actions, or legacy approvals as verified cash.
begin transaction read only;

select revenue_month,
       verified_payments,
       verified_net_positive_providers,
       verified_gross_baht,
       verified_refund_baht,
       verified_net_baht,
       erased_verified_payments,
       legacy_unverified_approvals,
       legacy_unverified_gross_baht
from public.pitch_revenue_monthly
order by revenue_month desc;

select coalesce((select sum(m.verified_payments) from public.pitch_revenue_monthly m), 0) as verified_payments,
       (select count(*) from (
          select r.provider_id
          from public.plan_requests r
          join public.plan_financial_evidence e on e.plan_request_id = r.id
          where r.provider_id is not null
          group by r.provider_id
          having sum(case when e.evidence_type = 'payment' then e.amount else -e.amount end) > 0
        ) net_positive) as net_positive_verified_customers_currently_linked,
       coalesce((select sum(m.verified_gross_baht) from public.pitch_revenue_monthly m), 0) as verified_gross_baht,
       coalesce((select sum(m.verified_refund_baht) from public.pitch_revenue_monthly m), 0) as verified_refund_baht,
       coalesce((select sum(m.verified_net_baht) from public.pitch_revenue_monthly m), 0) as verified_net_baht,
       coalesce((select sum(m.erased_verified_payments) from public.pitch_revenue_monthly m), 0) as erased_verified_payments,
       coalesce((select sum(m.legacy_unverified_approvals) from public.pitch_revenue_monthly m), 0) as legacy_unverified_approvals,
       coalesce((select sum(m.legacy_unverified_gross_baht) from public.pitch_revenue_monthly m), 0) as legacy_unverified_gross_baht;

select cohort_month,
       verified_first_month_payers,
       verified_renewed_in_month_2,
       verified_renewal_percent
from public.pitch_verified_month2_renewal
order by cohort_month desc;

-- Product activity among currently linked, verified paying customers. This is
-- engagement, not revenue, and erased providers are intentionally excluded.
select count(distinct r.provider_id) as linked_net_positive_verified_customers,
       count(distinct r.provider_id) filter (where exists (
         select 1 from public.usage_events u
         where u.provider_id = r.provider_id and u.mode = 'real' and u.event = 'app_open'
           and u.audience = 'public' and u.at >= now() - interval '30 days'
       )) as opened_last_30_days
from public.plan_requests r
where r.provider_id is not null and exists (
  select 1
  from public.plan_financial_evidence payment
  where payment.plan_request_id = r.id and payment.evidence_type = 'payment'
    and payment.amount > coalesce((select sum(refund.amount)
      from public.plan_financial_evidence refund
      where refund.payment_evidence_id = payment.id and refund.evidence_type = 'refund'), 0)
);

-- Acquisition funnel. Demo runs count as people trying the product, never as
-- product usage or revenue; team/QA traffic sits on its own audience axis.
-- A period with no rows means no data, not zero visitors inferred from nothing.
select day, audience, mode, visitors, sessions, landing_views, pricing_views,
       demo_started, demo_completed, signup_started, signup_completed, email_verified,
       onboarding_completed, opened_app, invoices_issued, payments_recorded
from public.usage_funnel_daily
where day >= (public.thai_today() - 90)
order by day desc, audience, mode;

-- Where visitors came from. Only values on the agreed list are stored, so a link carrying
-- anything else reads as 'unknown' and a visit with no ?c= at all has no source rather than a
-- guessed one. This is a per-browser first-touch label, not a claim about a person.
select coalesce(campaign, 'none') as source,
       audience,
       count(distinct teacher_id) as visitors,
       count(distinct session_id) as sessions,
       count(*) filter (where event in ('landing_view', 'pricing_view')) as pageviews,
       count(distinct session_id) filter (where event = 'signup_started') as signup_started
from public.usage_events
where at >= now() - interval '90 days'
group by 1, 2
order by visitors desc, source, audience;

-- The end of the funnel comes from server transactions and bank evidence,
-- never from a browser event: a client cannot claim it paid.
select month, pro_requested, pro_requesting_providers,
       subscription_payment_verified, refund_verified
from public.plan_funnel_monthly
order by month desc;

commit;
