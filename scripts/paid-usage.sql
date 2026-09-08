-- Run as an authorized operations role in the Supabase SQL editor. Counts only.
begin transaction read only;
select * from public.revenue_monthly order by paid_month desc;
select * from public.monthly_plan_month2_renewal order by cohort_month desc;
select
  count(*) as providers,
  count(*) filter (where p.plan = 'pro' and p.plan_until >= public.thai_today() and p.paused_at is null) as active_pro,
  count(*) filter (where exists (
    select 1 from public.usage_events u where u.provider_id = p.id and u.mode = 'real'
      and u.event = 'app_open' and u.at >= now() - interval '30 days'
  )) as providers_opened_last_30_days,
  count(*) filter (where exists (select 1 from public.plan_requests r where r.provider_id = p.id and r.status = 'approved')
    and exists (select 1 from public.usage_events u where u.provider_id = p.id and u.mode = 'real'
      and u.event = 'app_open' and u.at >= now() - interval '30 days')) as ever_paid_and_opened_last_30_days
from public.providers p;
commit;
