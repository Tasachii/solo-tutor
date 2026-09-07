#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
container_name="solo-line-pg16-${RANDOM}-$$"
db_password="solo-local-test"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --detach --name "$container_name" --env POSTGRES_PASSWORD="$db_password" \
  --volume "$repo_dir:/work:ro" postgres:16-alpine >/dev/null
# The postgres image runs a temporary socket-only server during initdb, so pg_isready
# answers "ready" before the real server exists and the next command dies with exit 2.
# Waiting on a TCP query skips that phantom: the init server never listens on 127.0.0.1.
ready=0
for _ in $(seq 1 60); do
  if docker exec --env PGPASSWORD="$db_password" "$container_name" \
      psql -U postgres -h 127.0.0.1 -Atqc 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "postgres never accepted a connection — container log follows" >&2
  docker logs "$container_name" >&2 || true
  exit 1
fi
docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres \
  -f /work/tests/sql/bootstrap_supabase.sql \
  -f /work/supabase/migrations/0001_line.sql \
  -f /work/supabase/migrations/0002_line_app_bridge.sql \
  -f /work/supabase/migrations/0003_intake.sql \
  -f /work/supabase/migrations/0004_usage.sql \
  -f /work/supabase/migrations/0005_ledger_sync.sql \
  -f /work/tests/sql/line_backend.sql \
  -f /work/tests/sql/ledger_sync.sql

redeem_sql="set role service_role; select ok from public.redeem_line_link_code(
  '10000000-0000-0000-0000-000000000001', 'line-redeem', '123456'
);"
first_out=$(mktemp)
second_out=$(mktemp)
trap 'rm -f "$first_out" "$second_out"; cleanup' EXIT
docker exec "$container_name" psql -Atq -U postgres -c "$redeem_sql" >"$first_out" &
first_pid=$!
docker exec "$container_name" psql -Atq -U postgres -c "$redeem_sql" >"$second_out" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
success_count=$(awk '$0 == "t" { count++ } END { print count + 0 }' "$first_out" "$second_out")
failure_count=$(awk '$0 == "f" { count++ } END { print count + 0 }' "$first_out" "$second_out")
if [[ "$success_count" != "1" || "$failure_count" != "1" ]]; then
  echo "concurrent redeem expected one success and one failure" >&2
  sed -n '1,20p' "$first_out" >&2
  sed -n '1,20p' "$second_out" >&2
  exit 1
fi

enqueue_sql="set role authenticated;
  select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
  select public.enqueue_line_message(
    '11100000-0000-0000-0000-000000000001', 'message-2', 'two', 'dedupe-2', now()
  );
  select public.enqueue_line_message(
    '11100000-0000-0000-0000-000000000001', 'message-3', 'three', 'dedupe-3', now()
  );"
docker exec "$container_name" psql -Atq -U postgres -c "$enqueue_sql" >/dev/null
claim_sql="set role service_role; select id from public.claim_line_outbox(
  '10000000-0000-0000-0000-000000000001', 1
);"
docker exec "$container_name" psql -Atq -U postgres -c "$claim_sql" >"$first_out" &
first_pid=$!
docker exec "$container_name" psql -Atq -U postgres -c "$claim_sql" >"$second_out" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
first_claim=$(awk 'NF { print; exit }' "$first_out")
second_claim=$(awk 'NF { print; exit }' "$second_out")
if [[ -z "$first_claim" || -z "$second_claim" || "$first_claim" == "$second_claim" ]]; then
  echo "concurrent outbox workers did not claim distinct rows" >&2
  exit 1
fi

# Release those test claims, leave one quota slot, then race two more workers.
near_quota_sql="update public.message_outbox set status = 'failed', error = 'test-cleanup',
    claim_token = null, claimed_at = null where status = 'processing';
  update public.line_channels set quota_used = 299, quota_limit = 300, quota_reserved = 0
    where provider_id = '10000000-0000-0000-0000-000000000001';
  set role authenticated;
  select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
  select public.enqueue_line_message(
    '11100000-0000-0000-0000-000000000001', 'message-4', 'four', 'dedupe-4', now()
  );
  select public.enqueue_line_message(
    '11100000-0000-0000-0000-000000000001', 'message-5', 'five', 'dedupe-5', now()
  );"
docker exec "$container_name" psql -Atq -U postgres -c "$near_quota_sql" >/dev/null
docker exec "$container_name" psql -Atq -U postgres -c "$claim_sql" >"$first_out" &
first_pid=$!
docker exec "$container_name" psql -Atq -U postgres -c "$claim_sql" >"$second_out" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
near_quota_claims=$(awk 'NF { count++ } END { print count + 0 }' "$first_out" "$second_out")
if [[ "$near_quota_claims" != "1" ]]; then
  echo "concurrent claims exceeded the provider quota reservation" >&2
  exit 1
fi
echo "PostgreSQL 16 LINE backend contract tests passed"
