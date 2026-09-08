\set ON_ERROR_STOP on
do $$
declare v_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
begin
  if (select last_value from public.plan_receipt_counters where receipt_month = v_month) <> 42 then
    raise exception 'migration did not continue the existing monthly receipt sequence';
  end if;
end $$;
-- Remove the upgrade fixture; keep the backfilled counter as production would.
delete from auth.users where id = '30000000-0000-0000-0000-000000000003';
