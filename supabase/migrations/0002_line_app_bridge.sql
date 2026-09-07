-- Browser-to-LINE bridge for Solo Tutor. Keeps local client identifiers tenant-scoped.

alter table public.line_channels
  add column if not exists basic_id text,
  add column if not exists updated_at timestamptz not null default now(),
  alter column channel_secret drop not null,
  alter column access_token drop not null;
grant select (basic_id, updated_at) on public.line_channels to authenticated;
alter table public.message_outbox
  add column if not exists last_error text generated always as (error) stored;

create table public.line_workspaces (
  provider_id uuid not null references public.providers(id) on delete cascade,
  workspace_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider_id, workspace_key)
);

create table public.line_workspace_clients (
  provider_id uuid not null,
  workspace_key uuid not null,
  local_client_key text not null check (length(btrim(local_client_key)) between 1 and 200),
  client_id uuid not null,
  local_name text not null check (length(btrim(local_name)) between 1 and 300),
  synced_at timestamptz not null default now(),
  primary key (provider_id, workspace_key, local_client_key),
  unique (provider_id, workspace_key, client_id),
  foreign key (provider_id, workspace_key)
    references public.line_workspaces(provider_id, workspace_key) on delete cascade,
  foreign key (provider_id, client_id)
    references public.clients(provider_id, id) on delete cascade
);

alter table public.line_workspaces enable row level security;
alter table public.line_workspace_clients enable row level security;
create policy line_workspaces_read_own on public.line_workspaces
  for select using (provider_id = auth.uid());
create policy line_workspace_clients_read_own on public.line_workspace_clients
  for select using (provider_id = auth.uid());

revoke all on public.line_workspaces, public.line_workspace_clients from public, anon, authenticated;
grant all on public.line_workspaces, public.line_workspace_clients to service_role;
grant select on public.line_workspaces, public.line_workspace_clients to authenticated;

-- Input items are {"id":"...","name":"..."}. Existing mappings keep their UUID.
create function public.sync_line_workspace_clients(p_workspace_key uuid, p_clients jsonb)
returns table (local_client_key text, client_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid := auth.uid();
  v_item jsonb;
  v_local_key text;
  v_name text;
  v_client_id uuid;
begin
  if v_provider_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_workspace_key is null or jsonb_typeof(p_clients) <> 'array' then
    raise exception 'invalid workspace clients' using errcode = '22023';
  end if;
  if jsonb_array_length(p_clients) > 1000 then
    raise exception 'too many workspace clients' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_clients) item
    group by btrim(item->>'id') having count(*) > 1
  ) then
    raise exception 'duplicate local client key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_provider_id::text || ':' || p_workspace_key::text, 0
  ));

  insert into public.line_workspaces(provider_id, workspace_key)
  values (v_provider_id, p_workspace_key)
  on conflict (provider_id, workspace_key) do update set updated_at = now();

  for v_item in select value from jsonb_array_elements(p_clients) loop
    v_local_key := btrim(v_item->>'id');
    v_name := btrim(v_item->>'name');
    if coalesce(length(v_local_key), 0) not between 1 and 200
       or coalesce(length(v_name), 0) not between 1 and 300 then
      raise exception 'invalid workspace client' using errcode = '22023';
    end if;

    select m.client_id into v_client_id
    from public.line_workspace_clients m
    where m.provider_id = v_provider_id and m.workspace_key = p_workspace_key
      and m.local_client_key = v_local_key for update;
    if v_client_id is null then
      v_client_id := gen_random_uuid();
      insert into public.clients(provider_id, id, name)
      values (v_provider_id, v_client_id, v_name);
      insert into public.line_workspace_clients(
        provider_id, workspace_key, local_client_key, client_id, local_name
      ) values (v_provider_id, p_workspace_key, v_local_key, v_client_id, v_name);
    else
      update public.clients c set name = v_name
      where c.provider_id = v_provider_id and c.id = v_client_id;
      update public.line_workspace_clients m set local_name = v_name, synced_at = now()
      where m.provider_id = v_provider_id and m.workspace_key = p_workspace_key
        and m.local_client_key = v_local_key;
    end if;
    local_client_key := v_local_key;
    client_id := v_client_id;
    return next;
  end loop;
end $$;

-- Returns one row only when the requested mapping belongs to the authenticated tenant.
create function public.line_delivery_target(p_workspace_key uuid, p_local_client_key text)
returns table (
  local_client_key text, client_id uuid, recipient_id uuid, line_user_id text,
  linked boolean, link_count integer, unfollowed_at timestamptz, channel_status text,
  quota_used integer, quota_limit integer, eligible boolean, reason text
) language sql security definer set search_path = public, pg_temp stable as $$
  select m.local_client_key, m.client_id,
    case when r.link_count = 1 then r.id end,
    case when r.link_count = 1 then r.line_user_id end,
    (r.link_count = 1 and r.linked_at is not null), r.link_count,
    case when r.link_count = 1 then r.unfollowed_at end,
    c.status, q.effective_used, c.quota_limit,
    (c.status = 'active' and q.effective_used + q.effective_reserved < c.quota_limit
      and r.link_count = 1 and r.linked_at is not null and r.unfollowed_at is null),
    case
      when c.provider_id is null then 'channel-not-configured'
      when c.status <> 'active' then 'channel-' || c.status
      when q.effective_used + q.effective_reserved >= c.quota_limit then 'quota-exhausted'
      when r.link_count > 1 then 'recipient-ambiguous'
      when r.id is null or r.linked_at is null then 'recipient-not-linked'
      when r.unfollowed_at is not null then 'recipient-unfollowed'
      else 'ok'
    end
  from public.line_workspace_clients m
  left join public.line_channels c on c.provider_id = m.provider_id
  left join lateral (
    select
      case when c.quota_month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date
        then c.quota_used else 0 end::integer as effective_used,
      case when c.quota_month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date
        then c.quota_reserved
        else (select count(*)::integer from public.message_outbox o
          where o.provider_id = m.provider_id and o.status = 'processing')
      end::integer as effective_reserved
  ) q on c.provider_id is not null
  left join lateral (
    select lr.*, count(*) over ()::integer as link_count from public.line_recipients lr
    where lr.provider_id = m.provider_id and lr.client_id = m.client_id
      and lr.linked_at is not null
    order by lr.linked_at desc nulls last, lr.id limit 1
  ) r on true
  where m.provider_id = auth.uid() and m.workspace_key = p_workspace_key
    and m.local_client_key = btrim(p_local_client_key);
$$;

-- Disconnect never labels an in-flight delivery unsent: those rows require manual review.
create function public.disconnect_line_channel()
returns table (status text, skipped_count integer, review_count integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_provider_id uuid := auth.uid();
  v_skipped integer := 0;
  v_review integer := 0;
begin
  if v_provider_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- Use the same channel -> outbox lock order as claim/finish and cancellation.
  perform 1 from public.line_channels c
  where c.provider_id = v_provider_id for update;
  update public.message_outbox o set status = 'skipped', error = 'channel-disconnected'
  where o.provider_id = v_provider_id and o.status = 'queued';
  get diagnostics v_skipped = row_count;
  update public.message_outbox o set status = 'manual_review',
    error = 'channel-disconnected-during-processing', claim_token = null, claimed_at = null
  where o.provider_id = v_provider_id and o.status = 'processing';
  get diagnostics v_review = row_count;
  update public.line_channels c set status = 'disabled', channel_secret = null,
    access_token = null, quota_reserved = 0, updated_at = now()
  where c.provider_id = v_provider_id;
  status := 'disabled'; skipped_count := v_skipped; review_count := v_review;
  return next;
end $$;

-- A personal-share fallback is safe only before the first delivery attempt.
create function public.cancel_line_message(p_dedupe_key text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_provider_id uuid := auth.uid(); v_existing_status text; v_existing_error text;
begin
  if v_provider_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- Match the claim/finish lock order before inspecting the outbox row.
  perform 1 from public.line_channels where provider_id = v_provider_id for update;
  select status, error into v_existing_status, v_existing_error
  from public.message_outbox
  where provider_id = v_provider_id and dedupe_key = p_dedupe_key for update;
  if not found then return false; end if;
  if v_existing_status = 'skipped' and v_existing_error = 'user-cancelled' then return true; end if;
  update public.message_outbox set status = 'skipped', error = 'user-cancelled'
  where provider_id = v_provider_id and dedupe_key = p_dedupe_key
    and (
      (status in ('queued', 'skipped', 'failed') and attempts = 0 and first_attempt_at is null)
      or (status in ('skipped', 'failed') and attempts = 1
        and error in ('invalid-token', 'blocked'))
    );
  return found;
end $$;

-- Service-only atomic credential replacement. A different bot invalidates bot-scoped recipients.
create function public.replace_line_channel(
  p_provider_id uuid, p_bot_user_id text, p_basic_id text, p_channel_secret text,
  p_access_token text, p_display_name text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old_bot text; v_processing integer := 0;
begin
  select bot_user_id into v_old_bot from public.line_channels
  where provider_id = p_provider_id for update;
  if v_old_bot is not null and v_old_bot <> p_bot_user_id then
    update public.message_outbox set status = 'skipped', error = 'line-bot-replaced'
    where provider_id = p_provider_id and status = 'queued';
    update public.message_outbox set status = 'manual_review', error = 'line-bot-replaced-during-processing',
      claim_token = null, claimed_at = null
    where provider_id = p_provider_id and status = 'processing';
    get diagnostics v_processing = row_count;
    delete from public.line_link_codes where provider_id = p_provider_id;
    update public.line_recipients set client_id = null, linked_at = null, unfollowed_at = now()
    where provider_id = p_provider_id;
  end if;
  insert into public.line_channels(
    provider_id, bot_user_id, basic_id, channel_secret, access_token, display_name,
    status, last_verified_at, updated_at
  ) values (
    p_provider_id, p_bot_user_id, p_basic_id, p_channel_secret, p_access_token,
    p_display_name, 'pending', null, now()
  ) on conflict (provider_id) do update set
    bot_user_id = excluded.bot_user_id, basic_id = excluded.basic_id,
    channel_secret = excluded.channel_secret, access_token = excluded.access_token,
    display_name = excluded.display_name, status = 'pending', last_verified_at = null,
    quota_reserved = greatest(0, line_channels.quota_reserved - v_processing), updated_at = now();
end $$;

-- Repeated identical calls are safe; a reused dedupe key with changed content fails closed.
create or replace function public.enqueue_line_message(
  p_recipient_id uuid, p_message_id text, p_body text, p_dedupe_key text,
  p_scheduled_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_provider_id uuid := auth.uid(); v_id uuid; v_existing public.message_outbox%rowtype;
begin
  if v_provider_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if coalesce(length(btrim(p_body)), 0) not between 1 and 5000 then
    raise exception 'invalid body' using errcode = '22023';
  end if;
  if coalesce(length(btrim(p_message_id)), 0) not between 1 and 1000
     or coalesce(length(btrim(p_dedupe_key)), 0) not between 1 and 1000 then
    raise exception 'invalid message identity' using errcode = '22023';
  end if;
  insert into public.message_outbox(provider_id, recipient_id, message_id, body, dedupe_key, scheduled_at)
  values (v_provider_id, p_recipient_id, p_message_id, p_body, p_dedupe_key,
    coalesce(p_scheduled_at, now()))
  on conflict (provider_id, dedupe_key) do nothing returning id into v_id;
  if v_id is not null then return v_id; end if;
  select * into v_existing from public.message_outbox
  where provider_id = v_provider_id and dedupe_key = p_dedupe_key;
  if v_existing.recipient_id = p_recipient_id and v_existing.message_id = p_message_id
     and v_existing.body = p_body
     and (p_scheduled_at is null or v_existing.scheduled_at = p_scheduled_at) then
    return v_existing.id;
  end if;
  raise exception 'dedupe key payload conflict' using errcode = '23505';
end $$;

-- Replace the 3-argument service RPC with a backwards-compatible optional exact row selector.
drop function public.claim_line_outbox(uuid, integer, boolean);
create function public.claim_line_outbox(
  p_provider_id uuid, p_limit integer default 20, p_auto boolean default false,
  p_outbox_id uuid default null
)
returns table (
  id uuid, recipient_id uuid, body text, attempts integer, retry_key uuid,
  claim_token uuid, line_user_id text, client_id uuid, unfollowed_at timestamptz
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_capacity integer; v_expired_claims integer; v_recovered integer; v_claimed integer;
  v_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
  v_channel_month date; v_inflight integer;
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
begin
  select c.quota_month into v_channel_month from public.line_channels c
  where c.provider_id = p_provider_id and c.status = 'active' for update;
  if not found then return; end if;
  if v_channel_month <> v_month then
    update public.message_outbox o set quota_month = v_month
    where o.provider_id = p_provider_id and o.status = 'processing';
    get diagnostics v_inflight = row_count;
    update public.line_channels set quota_month = v_month, quota_used = 0,
      quota_reserved = v_inflight where provider_id = p_provider_id;
  end if;
  with expired_candidates as (
    select o.provider_id, o.id, o.status from public.message_outbox o
    where o.provider_id = p_provider_id and o.first_attempt_at <= now() - interval '23 hours'
      and o.status in ('queued', 'processing') for update
  ), expired as (
    update public.message_outbox o set status = 'manual_review', error = 'retry-window-expired',
      claim_token = null, claimed_at = null
    from expired_candidates e where o.provider_id = e.provider_id and o.id = e.id
    returning (e.status = 'processing')::integer as was_claimed
  ) select coalesce(sum(was_claimed), 0) into v_expired_claims from expired;
  if v_expired_claims > 0 then
    update public.line_channels set quota_reserved = greatest(0, quota_reserved - v_expired_claims)
    where provider_id = p_provider_id;
  end if;
  with recovered as (
    update public.message_outbox o set status = 'queued', claim_token = null, claimed_at = null
    where o.provider_id = p_provider_id and o.status = 'processing'
      and o.claimed_at < now() - interval '10 minutes' returning 1
  ) select count(*) into v_recovered from recovered;
  if v_recovered > 0 then
    update public.line_channels set quota_reserved = greatest(0, quota_reserved - v_recovered)
    where provider_id = p_provider_id;
  end if;
  select greatest(0, (case when p_auto then least(c.quota_limit, 280) else c.quota_limit end)
    - c.quota_used - c.quota_reserved)
  into v_capacity from public.line_channels c where c.provider_id = p_provider_id;
  if v_capacity = 0 then return; end if;
  return query
  with eligible as (
    select o.provider_id, o.id, o.recipient_id, o.scheduled_at,
      row_number() over (partition by o.recipient_id order by o.scheduled_at, o.id) as recipient_rank
    from public.message_outbox o
    where o.provider_id = p_provider_id and o.scheduled_at <= now()
      and o.status = 'queued' and (p_outbox_id is null or o.id = p_outbox_id)
      and (not p_auto or not exists (
        select 1 from public.message_outbox sent
        where sent.provider_id = o.provider_id and sent.recipient_id = o.recipient_id
          and sent.auto_day = v_day and sent.status in ('processing', 'sent')
      ))
  ), candidates as (
    select o.provider_id, o.id from public.message_outbox o
    join eligible e on e.provider_id = o.provider_id and e.id = o.id
    where not p_auto or e.recipient_rank = 1
    order by e.scheduled_at, e.id for update of o skip locked
    limit least(greatest(1, least(p_limit, 100)), v_capacity)
  ), claimed as (
    update public.message_outbox o set status = 'processing', claimed_at = now(),
      claim_token = gen_random_uuid(), first_attempt_at = coalesce(o.first_attempt_at, now()),
      quota_month = v_month, auto_day = case when p_auto then v_day else o.auto_day end
    from candidates c where o.provider_id = c.provider_id and o.id = c.id returning o.*
  )
  select c.id, c.recipient_id, c.body, c.attempts, c.retry_key, c.claim_token,
    r.line_user_id, r.client_id, r.unfollowed_at
  from claimed c join public.line_recipients r
    on r.provider_id = c.provider_id and r.id = c.recipient_id
  order by c.scheduled_at, c.id;
  get diagnostics v_claimed = row_count;
  update public.line_channels set quota_reserved = quota_reserved + v_claimed
  where provider_id = p_provider_id;
end $$;

drop view public.line_channel_public;
create view public.line_channel_public with (security_invoker = true) as
  select provider_id, bot_user_id, basic_id, display_name, status, quota_used, quota_limit,
    quota_month, last_verified_at, created_at, updated_at from public.line_channels;
revoke all on public.line_channel_public from public, anon;
grant select on public.line_channel_public to authenticated;

revoke all on function public.sync_line_workspace_clients(uuid, jsonb) from public, anon;
revoke all on function public.line_delivery_target(uuid, text) from public, anon;
revoke all on function public.disconnect_line_channel() from public, anon;
revoke all on function public.cancel_line_message(text) from public, anon;
revoke all on function public.replace_line_channel(uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_line_outbox(uuid, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.sync_line_workspace_clients(uuid, jsonb) to authenticated;
grant execute on function public.line_delivery_target(uuid, text) to authenticated;
grant execute on function public.disconnect_line_channel() to authenticated;
grant execute on function public.cancel_line_message(text) to authenticated;
grant execute on function public.replace_line_channel(uuid, text, text, text, text, text) to service_role;
grant execute on function public.claim_line_outbox(uuid, integer, boolean, uuid) to service_role;
