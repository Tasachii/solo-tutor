\set ON_ERROR_STOP on
-- Rows written by the v1 counter, created before 0012 runs. The migration must carry every
-- one of them forward; losing history to make a new schema tidy is not allowed.
-- These rows stay anonymous and create no account: tests/sql/line_backend.sql counts providers
-- globally, so a fixture account here would break an unrelated suite.
insert into public.usage_events(teacher_id, event, count, mode, at) values
  ('11111111-1111-4111-8111-111111111111', 'app_open', 1, 'real', now() - interval '2 days'),
  ('11111111-1111-4111-8111-111111111111', 'invoice_issued', 3, 'real', now() - interval '2 days'),
  ('22222222-2222-4222-8222-222222222222', 'students_changed', 5, 'demo', now() - interval '400 days');
do $$
begin
  if (select count(*) from public.usage_events) <> 3 then
    raise exception 'the v1 fixture did not land on an empty counter table';
  end if;
end $$;
