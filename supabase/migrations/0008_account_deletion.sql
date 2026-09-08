-- Protect financial records even if approval races with the Auth deletion API.
-- Provider DELETE holds the same row lock as approve_plan_request. This trigger
-- runs before FK cascades can delete any children. No client can call it directly.
create function public.guard_provider_deletion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.plan_requests where provider_id = old.id and status = 'approved') then
    raise exception 'retention-required' using errcode = '23514';
  end if;
  delete from public.usage_events where provider_id = old.id;
  return old;
end $$;
revoke all on function public.guard_provider_deletion() from public, anon, authenticated;
create trigger protect_provider_financial_records before delete on public.providers
  for each row execute function public.guard_provider_deletion();
