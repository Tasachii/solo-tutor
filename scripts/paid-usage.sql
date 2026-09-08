-- Run as an authorized operations role in the Supabase SQL editor. Counts only.
-- Two revenue views exist. Only pitch_revenue_monthly counts service-verified bank evidence
-- (approve_plan_request_verified). revenue_monthly still sums every approved request,
-- including legacy approvals without bank evidence, and is reported here as UNVERIFIED.
begin transaction read only;
-- Verified cash (bank evidence) — the only figures allowed in a pitch or a P&L.
select 'verified' as basis, * from public.pitch_revenue_monthly order by revenue_month desc;
-- Legacy/unverified: approved requests regardless of evidence. Never present as revenue.
select 'unverified_legacy' as basis, * from public.revenue_monthly order by paid_month desc;
select 'unverified_legacy' as basis, * from public.monthly_plan_month2_renewal order by cohort_month desc;
select 'verified' as basis, * from public.pitch_verified_month2_renewal order by cohort_month desc;
select
  count(*) as providers,
  count(*) filter (where p.plan = 'pro' and p.plan_until >= public.thai_today() and p.paused_at is null) as active_pro,
  count(*) filter (where exists (
    select 1 from public.usage_events u where u.provider_id = p.id and u.mode = 'real'
      and u.event = 'app_open' and u.audience = 'public' and u.at >= now() - interval '30 days'
  )) as providers_opened_last_30_days,
  -- engagement only: "ever approved" includes legacy approvals, not verified cash
  count(*) filter (where exists (select 1 from public.plan_requests r where r.provider_id = p.id and r.status = 'approved')
    and exists (select 1 from public.usage_events u where u.provider_id = p.id and u.mode = 'real'
      and u.event = 'app_open' and u.audience = 'public' and u.at >= now() - interval '30 days')) as ever_approved_unverified_and_opened_last_30_days
from public.providers p;
-- Acquisition and activation counts, with team/QA traffic kept off the public axis.
select 'public' as audience, day, mode, visitors, sessions, landing_views, pricing_views,
       demo_started, demo_completed, signup_started, onboarding_completed
from public.usage_funnel_daily where audience = 'public' order by day desc;
commit;
