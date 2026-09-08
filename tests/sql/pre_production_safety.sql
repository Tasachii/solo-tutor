\set ON_ERROR_STOP on
-- Simulate a receipt already issued before migration 0007 reaches production.
insert into auth.users(id) values ('30000000-0000-0000-0000-000000000003');
insert into public.plan_requests(
  provider_id, months, amount, status, created_at, decided_at, receipt_no
) values (
  '30000000-0000-0000-0000-000000000003', 1, 299, 'approved', now(), now(),
  'SP-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMM') || '-0042'
);
