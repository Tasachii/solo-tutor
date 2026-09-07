\set ON_ERROR_STOP on
insert into auth.users(id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.providers) <> 2 then
    raise exception 'auth signup did not create provider prerequisites';
  end if;
end $$;
insert into public.clients(provider_id, id, name) values
  ('10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'owner client'),
  ('20000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'other client');
insert into public.line_channels(provider_id, bot_user_id, channel_secret, access_token, status) values
  ('10000000-0000-0000-0000-000000000001', 'bot-owner', 'secret-owner', 'token-owner', 'active'),
  ('20000000-0000-0000-0000-000000000002', 'bot-other', 'secret-other', 'token-other', 'active');
insert into public.line_recipients(provider_id, id, client_id, line_user_id, linked_at) values
  ('10000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001',
   '11000000-0000-0000-0000-000000000001', 'line-owner', now()),
  ('20000000-0000-0000-0000-000000000002', '22200000-0000-0000-0000-000000000002',
   '22000000-0000-0000-0000-000000000002', 'line-other', now());

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
begin
  if (select count(*) from public.line_channel_public) <> 1 then
    raise exception 'owner must see exactly one channel';
  end if;
  if (select provider_id from public.line_channel_public) <> '10000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'RLS exposed another owner';
  end if;
  if has_column_privilege('authenticated', 'public.line_channels', 'channel_secret', 'select')
     or has_column_privilege('authenticated', 'public.line_channels', 'access_token', 'select') then
    raise exception 'authenticated role can read a LINE secret';
  end if;
  if has_table_privilege('authenticated', 'public.message_outbox', 'insert')
     or has_table_privilege('authenticated', 'public.message_outbox', 'update') then
    raise exception 'authenticated role can forge delivery fields';
  end if;
end $$;
select * from public.issue_line_link_code(
  '11000000-0000-0000-0000-000000000001', now() + interval '1 hour'
) \gset issued_
select set_config('test.issued_code', :'issued_code', false);
do $$
begin
  if current_setting('test.issued_code') !~ '^[0-9]{6}$' then raise exception 'issued code is malformed'; end if;
  if not exists (select 1 from public.line_link_codes
    where provider_id = auth.uid() and code = current_setting('test.issued_code')) then
    raise exception 'issued code was not scoped to authenticated owner';
  end if;
end $$;

select public.enqueue_line_message(
  '11100000-0000-0000-0000-000000000001', 'message-1', 'hello', 'dedupe-1', now()
) as queued_id \gset
select set_config('test.queued_id', :'queued_id', false);
do $$
begin
  if (select status <> 'queued' or attempts <> 0 or sent_at is not null or retry_key is null
      from public.message_outbox where id = current_setting('test.queued_id')::uuid) then
    raise exception 'enqueue did not preserve server-owned defaults';
  end if;
end $$;

reset role;
insert into public.message_outbox(
  provider_id, recipient_id, message_id, body, dedupe_key, status, attempts,
  first_attempt_at, error
) values
  ('10000000-0000-0000-0000-000000000001',
   '11100000-0000-0000-0000-000000000001', 'definitive-unsent', 'definitive',
   'definitive-unsent', 'skipped', 1, now(), 'invalid-token'),
  ('10000000-0000-0000-0000-000000000001',
   '11100000-0000-0000-0000-000000000001', 'ambiguous-before-invalid', 'ambiguous',
   'ambiguous-before-invalid', 'skipped', 2, now() - interval '1 minute', 'invalid-token');
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
begin
  if not public.cancel_line_message('definitive-unsent') then
    raise exception 'definitive first-attempt failure could not be cancelled';
  end if;
  if public.cancel_line_message('ambiguous-before-invalid') then
    raise exception 'prior ambiguous attempt was incorrectly declared safe to share';
  end if;
end $$;
reset role;

-- Local app workspace mappings are stable and cannot cross tenant boundaries.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
select * from public.sync_line_workspace_clients(
  'aaaaaaaa-0000-4000-8000-000000000001',
  '[{"id":"local-c1","name":"Student One"},{"id":"local-c2","name":"Student Two"}]'::jsonb
) where local_client_key = 'local-c1' \gset mapped_
select set_config('test.mapped_client', :'mapped_client_id', false);
select * from public.sync_line_workspace_clients(
  'aaaaaaaa-0000-4000-8000-000000000001',
  '[{"id":"local-c1","name":"Student Renamed"}]'::jsonb
) where local_client_key = 'local-c1' \gset remapped_
select set_config('test.remapped_client', :'remapped_client_id', false);
do $$
begin
  if current_setting('test.mapped_client')::uuid <> current_setting('test.remapped_client')::uuid then
    raise exception 'workspace sync changed a stable client UUID';
  end if;
  if (select name from public.clients where provider_id = auth.uid()
      and id = current_setting('test.mapped_client')::uuid) <> 'Student Renamed' then
    raise exception 'workspace sync did not update the remote client name';
  end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
do $$
begin
  if exists (select 1 from public.line_delivery_target(
    'aaaaaaaa-0000-4000-8000-000000000001', 'local-c1'
  )) then raise exception 'delivery target crossed tenant boundary'; end if;
  if exists (select 1 from public.line_workspace_clients
    where workspace_key = 'aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'workspace mapping RLS crossed tenant boundary';
  end if;
end $$;
reset role;

-- Replacing an OA invalidates recipient identifiers scoped to the old bot.
set role service_role;
select public.replace_line_channel(
  '20000000-0000-0000-0000-000000000002', 'bot-other-new', '@othernew',
  'sealed-secret', 'sealed-token', 'Other New OA'
);
reset role;
do $$
begin
  if (select client_id is not null or linked_at is not null or unfollowed_at is null
      from public.line_recipients
      where provider_id = '20000000-0000-0000-0000-000000000002') then
    raise exception 'bot replacement retained an old bot-scoped recipient link';
  end if;
  if has_function_privilege('authenticated',
      'public.replace_line_channel(uuid,text,text,text,text,text)', 'execute') then
    raise exception 'authenticated users can call the service credential replacement RPC';
  end if;
end $$;

update public.line_recipients set client_id = current_setting('test.mapped_client')::uuid,
  linked_at = now(), unfollowed_at = null
where provider_id = '10000000-0000-0000-0000-000000000001'
  and id = '11100000-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
declare v_target record;
begin
  select * into v_target from public.line_delivery_target(
    'aaaaaaaa-0000-4000-8000-000000000001', 'local-c1'
  );
  if not v_target.eligible or v_target.reason <> 'ok' or v_target.link_count <> 1
     or v_target.client_id <> current_setting('test.mapped_client')::uuid then
    raise exception 'eligible delivery target contract is incorrect';
  end if;
end $$;
reset role;

-- A full prior month must read as reset, while current in-flight work still consumes capacity.
update public.line_channels set quota_month = date_trunc('month', now() - interval '1 month')::date,
  quota_used = quota_limit, quota_reserved = 1
where provider_id = '10000000-0000-0000-0000-000000000001';
insert into public.message_outbox(
  provider_id, recipient_id, message_id, body, dedupe_key, status,
  first_attempt_at, quota_month, claimed_at, claim_token
) values (
  '10000000-0000-0000-0000-000000000001',
  '11100000-0000-0000-0000-000000000001', 'target-month-rollover', 'in flight',
  'target-month-rollover', 'processing', now(),
  date_trunc('month', now() - interval '1 month')::date, now(),
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
);
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
declare v_target record;
begin
  select * into v_target from public.line_delivery_target(
    'aaaaaaaa-0000-4000-8000-000000000001', 'local-c1'
  );
  if not v_target.eligible or v_target.reason <> 'ok' or v_target.quota_used <> 0 then
    raise exception 'prior-month quota did not reset in delivery target';
  end if;
end $$;
reset role;
update public.message_outbox set status = 'failed', error = 'test-cleanup',
  claim_token = null, claimed_at = null where dedupe_key = 'target-month-rollover';
update public.line_channels set quota_month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date,
  quota_used = 0, quota_reserved = 0
where provider_id = '10000000-0000-0000-0000-000000000001';

-- Enqueue retries are idempotent only for byte-for-byte equivalent payload fields.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
select public.enqueue_line_message(
  '11100000-0000-0000-0000-000000000001', 'idem-message', 'same body', 'idem-key',
  '2030-01-01T00:00:00Z'
) as idem_id \gset
select set_config('test.idem_id', :'idem_id', false);
select public.enqueue_line_message(
  '11100000-0000-0000-0000-000000000001', 'idem-default', 'same default body',
  'idem-default-key'
) as idem_default_id \gset
select set_config('test.idem_default_id', :'idem_default_id', false);
do $$
begin
  if public.enqueue_line_message(
    '11100000-0000-0000-0000-000000000001', 'idem-default', 'same default body',
    'idem-default-key'
  ) <> current_setting('test.idem_default_id')::uuid then
    raise exception 'omitted schedule made an identical enqueue conflict';
  end if;
  if public.enqueue_line_message(
    '11100000-0000-0000-0000-000000000001', 'idem-message', 'same body', 'idem-key',
    '2030-01-01T00:00:00Z'
  ) <> current_setting('test.idem_id')::uuid then
    raise exception 'identical enqueue did not return existing ID';
  end if;
  begin
    perform public.enqueue_line_message(
      '11100000-0000-0000-0000-000000000001', 'idem-message', 'changed', 'idem-key',
      '2030-01-01T00:00:00Z'
    );
    raise exception 'changed payload reused a dedupe key';
  exception when unique_violation then null;
  end;
  begin
    perform public.enqueue_line_message(
      '11100000-0000-0000-0000-000000000001', 'oversized', repeat('ก', 5001),
      'oversized-key'
    );
    raise exception 'oversized body was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.enqueue_line_message(
      '11100000-0000-0000-0000-000000000001', '   ', 'body', 'bounded-id-key'
    );
    raise exception 'blank message identity was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.enqueue_line_message(
      '11100000-0000-0000-0000-000000000001', 'bounded-id', 'body', repeat('d', 1001)
    );
    raise exception 'oversized dedupe key was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- A queued, never-attempted row can be cancelled for safe personal sharing.
select public.enqueue_line_message(
  '11100000-0000-0000-0000-000000000001', 'cancel-me', 'cancel body', 'cancel-key', now()
) as cancel_id \gset
select set_config('test.cancel_id', :'cancel_id', false);
do $$
begin
  if not public.cancel_line_message('cancel-key') or not public.cancel_line_message('cancel-key') then
    raise exception 'safe cancellation was not idempotent';
  end if;
  if (select status <> 'skipped' or error <> 'user-cancelled'
      from public.message_outbox where id = current_setting('test.cancel_id')::uuid) then
    raise exception 'safe cancellation did not mark the queued row';
  end if;
  if (select last_error from public.message_outbox
      where id = current_setting('test.cancel_id')::uuid) <> 'user-cancelled' then
    raise exception 'public outbox error alias is stale';
  end if;
end $$;
reset role;

-- Exact claiming never drains a neighboring queued message.
update public.line_channels set status = 'active', quota_used = 0, quota_reserved = 0
where provider_id = '10000000-0000-0000-0000-000000000001';
insert into public.message_outbox(provider_id, recipient_id, message_id, body, dedupe_key)
values
  ('10000000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000001',
   'exact-a','a','exact-a'),
  ('10000000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000001',
   'exact-b','b','exact-b');
set role service_role;
do $$
declare v_a uuid; v_b uuid; v_claimed uuid;
begin
  select id into v_a from public.message_outbox where dedupe_key = 'exact-a';
  select id into v_b from public.message_outbox where dedupe_key = 'exact-b';
  select id into v_claimed from public.claim_line_outbox(
    '10000000-0000-0000-0000-000000000001', 1, false, v_b
  );
  if v_claimed <> v_b then raise exception 'targeted claim returned a different row'; end if;
  if (select status from public.message_outbox where id = v_a) <> 'queued' then
    raise exception 'targeted claim drained a neighboring row';
  end if;
end $$;
reset role;

-- Disconnect erases credentials, skips untouched queue, and preserves ambiguous rows for review.
update public.message_outbox set status = 'manual_review', error = 'test-existing-review',
  claim_token = null, claimed_at = null where dedupe_key = 'exact-b';
insert into public.message_outbox(provider_id, recipient_id, message_id, body, dedupe_key)
values ('10000000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000001',
  'disconnect-queued','queued','disconnect-queued');
insert into public.message_outbox(provider_id, recipient_id, message_id, body, dedupe_key,
  status, first_attempt_at, claimed_at, claim_token, quota_month)
values ('10000000-0000-0000-0000-000000000001','11100000-0000-0000-0000-000000000001',
  'disconnect-processing','processing','disconnect-processing','processing',now(),now(),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',date_trunc('month', now())::date);
update public.line_channels set quota_reserved = 1
where provider_id = '10000000-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$
declare v_result record;
begin
  select * into v_result from public.disconnect_line_channel();
  if v_result.status <> 'disabled' or v_result.review_count <> 1 then
    raise exception 'disconnect result counts are incorrect';
  end if;
  if (select status from public.message_outbox where dedupe_key = 'disconnect-queued') <> 'skipped'
     or (select status from public.message_outbox where dedupe_key = 'disconnect-processing') <> 'manual_review'
     or (select error from public.message_outbox where dedupe_key = 'exact-b') <> 'test-existing-review' then
    raise exception 'disconnect lost safe/ambiguous outbox state';
  end if;
end $$;
reset role;
do $$
begin
  if (select channel_secret is not null or access_token is not null or quota_reserved <> 0
      from public.line_channels
      where provider_id = '10000000-0000-0000-0000-000000000001') then
    raise exception 'disconnect retained credentials or reservation';
  end if;
end $$;

-- Restore the fixture channel for the original 0001 regression suite below.
update public.line_channels set status = 'active', channel_secret = 'secret-owner',
  access_token = 'token-owner', quota_reserved = 0
where provider_id = '10000000-0000-0000-0000-000000000001';
insert into public.message_outbox(provider_id, recipient_id, message_id, body, dedupe_key)
values ('10000000-0000-0000-0000-000000000001',
  '11100000-0000-0000-0000-000000000001', 'regression-restored', 'restored',
  'regression-restored');

set role service_role;
select public.claim_line_webhook_event(
  '10000000-0000-0000-0000-000000000001', 'event-1'
) as webhook_token \gset
select set_config('test.webhook_token', :'webhook_token', false);
do $$
begin
  if current_setting('test.webhook_token', true) = '' then raise exception 'first webhook claim failed'; end if;
  if public.claim_line_webhook_event(
    '10000000-0000-0000-0000-000000000001', 'event-1'
  ) is not null then raise exception 'duplicate webhook event was claimed'; end if;
  if not public.finish_line_webhook_event(
    '10000000-0000-0000-0000-000000000001', 'event-1',
    current_setting('test.webhook_token')::uuid, true, null
  ) then raise exception 'webhook claim could not finish'; end if;
  if public.claim_line_webhook_event(
    '10000000-0000-0000-0000-000000000001', 'event-1'
  ) is not null then raise exception 'processed webhook redelivery was claimed'; end if;
end $$;
reset role;

update public.message_outbox set status = 'failed', error = 'test-cleanup',
  claim_token = null, claimed_at = null where status = 'processing';
update public.line_channels set quota_used = 0, quota_reserved = 0
where provider_id = '10000000-0000-0000-0000-000000000001';
insert into public.message_outbox(provider_id, recipient_id, message_id, body, dedupe_key)
values
  ('10000000-0000-0000-0000-000000000001',
   '11100000-0000-0000-0000-000000000001', 'auto-one', 'one', 'auto-one'),
  ('10000000-0000-0000-0000-000000000001',
   '11100000-0000-0000-0000-000000000001', 'auto-two', 'two', 'auto-two');
set role service_role;
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.claim_line_outbox(
    '10000000-0000-0000-0000-000000000001', 20, true
  );
  if v_count <> 1 then raise exception 'auto claim did not limit recipient to one message'; end if;
  select count(*) into v_count from public.claim_line_outbox(
    '10000000-0000-0000-0000-000000000001', 20, true
  );
  if v_count <> 0 then raise exception 'second auto claim repeated recipient in Bangkok day'; end if;
  select count(*) into v_count from public.claim_line_outbox(
    '10000000-0000-0000-0000-000000000001', 20, false
  );
  if v_count <> 2 then raise exception 'manual claim was incorrectly limited to one per day'; end if;
end $$;
reset role;

update public.message_outbox set status = 'failed', error = 'test-cleanup',
  claim_token = null, claimed_at = null where status = 'processing';
update public.line_channels set quota_reserved = 0
where provider_id = '10000000-0000-0000-0000-000000000001';
insert into public.message_outbox(provider_id, recipient_id, message_id, body, dedupe_key)
values ('10000000-0000-0000-0000-000000000001',
  '11100000-0000-0000-0000-000000000001', 'message-standard', 'standard', 'standard');

do $$
begin
  begin
    insert into public.line_link_codes(provider_id, code, client_id, expires_at)
    values ('10000000-0000-0000-0000-000000000001', '999999',
            '22000000-0000-0000-0000-000000000002', now() + interval '1 hour');
    raise exception 'cross-tenant client reference was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.message_outbox(provider_id, recipient_id, message_id, body, dedupe_key)
    values ('10000000-0000-0000-0000-000000000001',
            '22200000-0000-0000-0000-000000000002', 'forged', 'bad', 'cross-tenant');
    raise exception 'cross-tenant recipient reference was accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

insert into public.line_recipients(provider_id, id, line_user_id) values
  ('10000000-0000-0000-0000-000000000001',
   '11100000-0000-0000-0000-000000000009', 'line-redeem');
insert into public.line_link_codes(provider_id, code, client_id, expires_at) values
  ('10000000-0000-0000-0000-000000000001', '123456',
   '11000000-0000-0000-0000-000000000001', now() + interval '1 hour');

set role service_role;
select * from public.claim_line_outbox('10000000-0000-0000-0000-000000000001', 20) \gset claim_
select set_config('test.claim_id', :'claim_id', false);
select set_config('test.claim_token', :'claim_claim_token', false);
select set_config('test.retry_key', :'claim_retry_key', false);
do $$
begin
  if current_setting('test.retry_key')::uuid is null or current_setting('test.claim_token')::uuid is null then
    raise exception 'claim omitted stable retry/claim key';
  end if;
  if not public.finish_line_outbox(
    '10000000-0000-0000-0000-000000000001', current_setting('test.claim_id')::uuid,
    current_setting('test.claim_token')::uuid,
    'sent', null, null
  ) then raise exception 'valid claim could not be settled'; end if;
  if public.finish_line_outbox(
    '10000000-0000-0000-0000-000000000001', current_setting('test.claim_id')::uuid,
    current_setting('test.claim_token')::uuid,
    'sent', null, null
  ) then raise exception 'claim was settled twice'; end if;
end $$;
reset role;

do $$
begin
  if (select quota_used from public.line_channels
      where provider_id = '10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'sent row and quota were not settled together';
  end if;
end $$;

insert into public.message_outbox(
  provider_id, recipient_id, message_id, body, dedupe_key, first_attempt_at
) values (
  '10000000-0000-0000-0000-000000000001',
  '11100000-0000-0000-0000-000000000001',
  'expired-retry', 'ambiguous delivery', 'expired-retry',
  now() - interval '24 hours'
);
set role service_role;
do $$
begin
  if exists (select 1 from public.claim_line_outbox(
    '10000000-0000-0000-0000-000000000001', 20
  )) then raise exception 'expired retry key was claimed'; end if;
  if (select status from public.message_outbox where dedupe_key = 'expired-retry') <> 'manual_review' then
    raise exception 'expired retry key did not fail closed to manual review';
  end if;
end $$;
reset role;

update public.line_channels set quota_month = (current_date - interval '1 month')::date,
  quota_used = 299, quota_reserved = 1
where provider_id = '10000000-0000-0000-0000-000000000001';
insert into public.message_outbox(
  provider_id, recipient_id, message_id, body, dedupe_key, status,
  first_attempt_at, quota_month, claimed_at, claim_token
) values (
  '10000000-0000-0000-0000-000000000001',
  '11100000-0000-0000-0000-000000000001',
  'month-boundary', 'month boundary', 'month-boundary', 'processing', now(),
  (current_date - interval '1 month')::date, now(),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
set role service_role;
do $$
declare v_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
begin
  perform * from public.claim_line_outbox(
    '10000000-0000-0000-0000-000000000001', 1, false
  );
  if (select quota_month from public.line_channels
      where provider_id = '10000000-0000-0000-0000-000000000001') <> v_month
     or (select quota_used from public.line_channels
      where provider_id = '10000000-0000-0000-0000-000000000001') <> 0
     or (select quota_reserved from public.line_channels
      where provider_id = '10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'monthly rollover did not preserve in-flight reservation';
  end if;
  if not public.finish_line_outbox(
    '10000000-0000-0000-0000-000000000001',
    (select id from public.message_outbox where dedupe_key = 'month-boundary'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sent', null, null
  ) then raise exception 'month-boundary claim could not finish'; end if;
  if (select quota_used <> 1 or quota_reserved <> 0 from public.line_channels
      where provider_id = '10000000-0000-0000-0000-000000000001') then
    raise exception 'month-boundary delivery counted in wrong month';
  end if;
end $$;
reset role;

update public.line_channels set quota_used = 280, quota_reserved = 0
where provider_id = '10000000-0000-0000-0000-000000000001';
insert into public.message_outbox(provider_id, recipient_id, message_id, body, dedupe_key)
values ('10000000-0000-0000-0000-000000000001',
  '11100000-0000-0000-0000-000000000001', 'auto-paused', 'keep queued', 'auto-paused');
set role service_role;
do $$
begin
  if exists (select 1 from public.claim_line_outbox(
    '10000000-0000-0000-0000-000000000001', 20, true
  )) then raise exception 'automatic worker claimed above auto ceiling'; end if;
  if (select status from public.message_outbox where dedupe_key = 'auto-paused') <> 'queued' then
    raise exception 'automatic quota pause discarded the queued message';
  end if;
  if not exists (select 1 from public.claim_line_outbox(
    '10000000-0000-0000-0000-000000000001', 20, false
  )) then raise exception 'manual worker could not claim above auto ceiling'; end if;
end $$;
reset role;
