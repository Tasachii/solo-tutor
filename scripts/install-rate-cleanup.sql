-- Supabase operational setup after migration0007; this only expires technical
-- anti-abuse buckets. It never deletes teacher, student or financial data.
-- Supabase provides pg_cron; vanilla PostgreSQL contract containers need not install it.
begin;
create extension if not exists pg_cron;
select cron.schedule(
  'solo-public-rate-limit-cleanup',
  '17 * * * *',
  $$select public.cleanup_public_rate_limits();$$
);
commit;
