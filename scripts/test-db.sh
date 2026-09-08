#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
postgres_image="${SOLO_TEST_POSTGRES_IMAGE:-postgres:16-alpine}"
container_name="solo-line-db-${RANDOM}-$$"
db_password="solo-local-test"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --detach --name "$container_name" --env POSTGRES_PASSWORD="$db_password" \
  --volume "$repo_dir:/work:ro" "$postgres_image" >/dev/null
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
# Migrations are discovered from the directory in numeric order, so adding one needs no
# edit here. Two files must run inside that sequence: pre_production_safety seeds rows that
# 0007 has to survive, and post_production_safety checks the result before 0008 builds on it.
migration_args=()
for path in "$repo_dir"/supabase/migrations/*.sql; do
  name=$(basename "$path")
  case "$name" in
    0007_*) migration_args+=(-f /work/tests/sql/pre_production_safety.sql) ;;
    # 0012 ต้องยกแถวรุ่นเดิมมาให้ครบ จึงต้องมีแถวรุ่นเดิมอยู่ก่อนไมเกรชันจะรัน
    0012_*) migration_args+=(-f /work/tests/sql/pre_usage_events_v2.sql) ;;
  esac
  migration_args+=(-f "/work/supabase/migrations/$name")
  case "$name" in
    0007_*) migration_args+=(-f /work/tests/sql/post_production_safety.sql) ;;
  esac
done
if [[ ${#migration_args[@]} -eq 0 ]]; then
  echo "no migrations found under supabase/migrations" >&2
  exit 1
fi

docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U postgres \
  -f /work/tests/sql/bootstrap_supabase.sql \
  "${migration_args[@]}" \
  -f /work/scripts/check-operations.sql \
  -f /work/tests/sql/line_backend.sql \
  -f /work/tests/sql/shared_documents.sql \
  -f /work/tests/sql/shared_document_rate_limit.sql \
  -f /work/tests/sql/ledger_sync.sql \
  -f /work/tests/sql/plans.sql \
  -f /work/tests/sql/production_safety.sql \
  -f /work/tests/sql/account_deletion.sql \
  -f /work/tests/sql/payment_evidence.sql \
  -f /work/tests/sql/operations_role.sql \
  -f /work/tests/sql/retention.sql \
  -f /work/tests/sql/usage_events_v2.sql \
  -f /work/scripts/paid-usage.sql \
  -f /work/scripts/pitch-metrics.sql

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

# Race two plan requests for one provider. The provider row lock + partial unique
# index must permit exactly one pending request.
plan_request_sql="set role authenticated;
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
  select id from public.request_plan(1, null);"
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c "$plan_request_sql" >"$first_out" 2>&1 &
first_pid=$!
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c "$plan_request_sql" >"$second_out" 2>&1 &
second_pid=$!
if wait "$first_pid"; then first_status=0; else first_status=$?; fi
if wait "$second_pid"; then second_status=0; else second_status=$?; fi
if [[ "$first_status" == "$second_status" ]]; then
  echo "concurrent plan requests expected exactly one success" >&2
  sed -n '1,20p' "$first_out" >&2
  sed -n '1,20p' "$second_out" >&2
  exit 1
fi
pending_count=$(docker exec "$container_name" psql -Atq -U postgres -c \
  "select count(*) from public.plan_requests where provider_id = '20000000-0000-0000-0000-000000000002' and status = 'pending';")
if [[ "$pending_count" != "1" ]]; then
  echo "concurrent plan requests left $pending_count pending rows" >&2
  exit 1
fi

# Approve pending requests for two providers concurrently. The monthly counter row
# serializes receipt allocation, so both approvals succeed with distinct numbers.
docker exec "$container_name" psql -Atq -U postgres -c \
  "insert into public.plan_requests(provider_id, months, amount) values
   ('10000000-0000-0000-0000-000000000001', 1, 299);" >/dev/null
first_request=$(docker exec "$container_name" psql -Atq -U postgres -c \
  "select id from public.plan_requests where provider_id = '10000000-0000-0000-0000-000000000001' and status = 'pending';")
second_request=$(docker exec "$container_name" psql -Atq -U postgres -c \
  "select id from public.plan_requests where provider_id = '20000000-0000-0000-0000-000000000002' and status = 'pending';")
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "set role service_role; select receipt_no from public.approve_plan_request('$first_request');" >"$first_out" &
first_pid=$!
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "set role service_role; select receipt_no from public.approve_plan_request('$second_request');" >"$second_out" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
first_receipt=$(awk 'NF { print; exit }' "$first_out")
second_receipt=$(awk 'NF { print; exit }' "$second_out")
if [[ -z "$first_receipt" || -z "$second_receipt" || "$first_receipt" == "$second_receipt" ]]; then
  echo "concurrent approvals did not allocate distinct receipts" >&2
  exit 1
fi

# Approval locks the provider before the request. When approval wins the race,
# deletion waits, then detaches the issued receipt instead of cascading it away.
approval_first_user="d2000000-0000-4000-8000-000000000001"
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "insert into auth.users(id) values ('$approval_first_user');
   insert into public.plan_requests(provider_id, months, amount, note)
     values ('$approval_first_user', 1, 299, 'approval-first');" >/dev/null
approval_first_request=$(docker exec "$container_name" psql -Atq -U postgres -c \
  "select id from public.plan_requests where provider_id = '$approval_first_user' and status = 'pending';")
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "begin; set role service_role;
   select receipt_no from public.approve_plan_request('$approval_first_request');
   select pg_sleep(1); commit;" >"$first_out" 2>&1 &
first_pid=$!
sleep 0.2
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "delete from auth.users where id = '$approval_first_user';" >"$second_out" 2>&1 &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
approval_first_state=$(docker exec "$container_name" psql -Atq -U postgres -c \
  "select count(*) || ':' || count(*) filter (where status = 'approved' and provider_id is null
       and note is null and receipt_no is not null)
   from public.plan_requests where id = '$approval_first_request';")
if [[ "$approval_first_state" != "1:1" ]]; then
  echo "approval-first deletion did not retain one detached issued receipt ($approval_first_state)" >&2
  exit 1
fi

# When deletion wins, the pending request is removed before approval can lock its
# provider. Approval must fail rather than return an empty/success-looking result.
deletion_first_user="d2000000-0000-4000-8000-000000000002"
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "insert into auth.users(id) values ('$deletion_first_user');
   insert into public.plan_requests(provider_id, months, amount, note)
     values ('$deletion_first_user', 1, 299, 'deletion-first');" >/dev/null
deletion_first_request=$(docker exec "$container_name" psql -Atq -U postgres -c \
  "select id from public.plan_requests where provider_id = '$deletion_first_user' and status = 'pending';")
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "begin; delete from auth.users where id = '$deletion_first_user';
   select pg_sleep(1); commit;" >"$first_out" 2>&1 &
first_pid=$!
sleep 0.2
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "set role service_role;
   select receipt_no from public.approve_plan_request('$deletion_first_request');" >"$second_out" 2>&1 &
second_pid=$!
wait "$first_pid"
if wait "$second_pid"; then
  echo "deletion-first approval reported success after its provider was removed" >&2
  sed -n '1,20p' "$second_out" >&2
  exit 1
fi
deletion_first_rows=$(docker exec "$container_name" psql -Atq -U postgres -c \
  "select count(*) from public.plan_requests where id = '$deletion_first_request';")
if [[ "$deletion_first_rows" != "0" ]]; then
  echo "deletion-first race left a pending or falsely approved request" >&2
  exit 1
fi

# Hold the payment row lock after the first refund so a second session must
# recheck the committed refund total. Two 200-baht refunds against 299 baht may
# produce exactly one stored refund and can never over-refund.
refund_race_user="d2000000-0000-4000-8000-000000000003"
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "insert into auth.users(id) values ('$refund_race_user');
   insert into public.plan_requests(provider_id, months, amount, note)
     values ('$refund_race_user', 1, 299, 'refund-race');" >/dev/null
refund_race_request=$(docker exec "$container_name" psql -Atq -U postgres -c \
  "select id from public.plan_requests where provider_id = '$refund_race_user' and status = 'pending';")
refund_race_payment=$(docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "set role service_role;
   select evidence_id from public.approve_plan_request_verified(
     '$refund_race_request', 'BANK-RACE-PAYMENT', 299, now(), 'race-test');")
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "begin; set role service_role;
   select evidence_id from public.record_plan_refund(
     '$refund_race_payment', 'BANK-RACE-REFUND-A', 200, now(), 'race-test');
   select pg_sleep(1); commit;" >"$first_out" 2>&1 &
first_pid=$!
sleep 0.2
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "set role service_role;
   select evidence_id from public.record_plan_refund(
     '$refund_race_payment', 'BANK-RACE-REFUND-B', 200, now(), 'race-test');" >"$second_out" 2>&1 &
second_pid=$!
if wait "$first_pid"; then first_status=0; else first_status=$?; fi
if wait "$second_pid"; then second_status=0; else second_status=$?; fi
if [[ "$first_status" == "$second_status" ]]; then
  echo "concurrent refunds expected exactly one success" >&2
  sed -n '1,20p' "$first_out" >&2
  sed -n '1,20p' "$second_out" >&2
  exit 1
fi
refund_race_state=$(docker exec "$container_name" psql -Atq -U postgres -c \
  "select count(*) || ':' || coalesce(sum(amount), 0)
   from public.plan_financial_evidence
   where payment_evidence_id = '$refund_race_payment' and evidence_type = 'refund';")
if [[ "$refund_race_state" != "1:200" ]]; then
  echo "concurrent refunds stored an invalid count or total ($refund_race_state)" >&2
  exit 1
fi

# Monitoring is intentionally read-only and must fail when mock operational work
# needs attention. Insert only synthetic markers, assert failure, then remove them.
docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres -c \
  "insert into public.client_errors(message) values ('operations-test');
   insert into public.plan_requests(provider_id, months, amount, note, created_at)
     values ('10000000-0000-0000-0000-000000000001', 1, 299, 'operations-test', now() - interval '25 hours');
   update public.message_outbox set status = 'manual_review', error = 'operations-test',
     claim_token = null, claimed_at = null
   where id = (select id from public.message_outbox limit 1);" >/dev/null
if docker exec "$container_name" psql -Atq -v ON_ERROR_STOP=1 -U postgres \
    -f /work/scripts/check-operations.sql >"$first_out" 2>&1; then
  echo "operations check did not fail for synthetic stale work" >&2
  exit 1
fi
if ! grep -q "operations thresholds exceeded" "$first_out"; then
  echo "operations check failed without the expected threshold diagnostic" >&2
  sed -n '1,40p' "$first_out" >&2
  exit 1
fi
echo "$postgres_image LINE backend contract tests passed"
