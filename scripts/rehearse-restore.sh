#!/usr/bin/env bash
# ซ้อมกู้ backup ลงฐาน PostgreSQL แยก (Docker) แล้วตรวจ schema/RLS/แถว — ไม่มีทางแตะ production
# ใช้: BACKUP_PASSPHRASE=… bash scripts/rehearse-restore.sh BACKUP.tar.gz.solobak [evidence.json]
#  หรือ: bash scripts/rehearse-restore.sh DUMP_DIR [evidence.json]  (โฟลเดอร์ที่มี schema.sql data.sql)
# ผลลัพธ์เป็น JSON ที่มีแต่ตัวเลข (จำนวนตาราง/แถว/นโยบาย) ไม่มีข้อมูลบุคคล
set -euo pipefail
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
source=${1:?backup archive or dump directory}
evidence=${2:-}
image=${SOLO_TEST_POSTGRES_IMAGE:-postgres:17-alpine}
work=$(mktemp -d)
container="solo-restore-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

if [[ -d "$source" ]]; then
  cp "$source"/schema.sql "$source"/data.sql "$work"/
  [[ -f "$source/roles.sql" ]] && cp "$source/roles.sql" "$work"/
else
  : "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE in the environment (never on the command line)}"
  node "$repo_dir/scripts/backup-crypto.mjs" decrypt "$source" "$work/restored.tar.gz" >/dev/null
  tar -xzf "$work/restored.tar.gz" -C "$work"
  mv "$work"/dump/* "$work"/ 2>/dev/null || true
  rm -f "$work/restored.tar.gz"
fi
test -s "$work/schema.sql" -a -s "$work/data.sql" || { echo "schema.sql/data.sql missing" >&2; exit 1; }
# extension ที่ Supabase ใส่มาเองแต่ migration ของเราไม่ใช้ (pg_cron/vault/uuid-ossp/pg_stat_statements)
# ไม่มีใน postgres ธรรมดา — ตัดออกเฉพาะบรรทัดเหล่านี้ ที่เหลือต้องผ่านทั้งหมด
# dump จาก pg_dump ธรรมดา (ไม่ใช่ supabase CLI) ยังมี CREATE SCHEMA public ซึ่งฐานใหม่มีอยู่แล้ว — ตัดออกเช่นกัน
grep -vE 'CREATE EXTENSION IF NOT EXISTS "(pg_cron|pg_stat_statements|supabase_vault|uuid-ossp)"|ALTER PUBLICATION "supabase_realtime"|^CREATE SCHEMA (IF NOT EXISTS )?public;|^COMMENT ON SCHEMA public ' "$work/schema.sql" > "$work/schema.portable.sql"
skipped=$(( $(wc -l < "$work/schema.sql") - $(wc -l < "$work/schema.portable.sql") ))

docker run --detach --name "$container" --env POSTGRES_PASSWORD=solo-restore \
  --volume "$repo_dir/tests/sql:/bootstrap:ro" --volume "$work:/dump:ro" "$image" >/dev/null
for _ in $(seq 1 60); do
  docker exec --env PGPASSWORD=solo-restore "$container" psql -U postgres -h 127.0.0.1 -Atqc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
psql_in() { docker exec "$container" psql -U postgres -X -v ON_ERROR_STOP=1 "$@"; }
# roles/auth stub ที่ dump ของ Supabase อ้างถึง (auth.users, anon/authenticated/service_role)
psql_in -q -f /bootstrap/bootstrap_supabase.sql >/dev/null
psql_in -q -c "create schema if not exists extensions; create schema if not exists vault;" >/dev/null
psql_in -q -f /dump/schema.portable.sql >/dev/null
psql_in -q -f /dump/data.sql >/dev/null

tables=$(psql_in -Atqc "select count(*) from pg_tables where schemaname='public'")
unprotected=$(psql_in -Atqc "select count(*) from pg_tables where schemaname='public' and not rowsecurity")
policies=$(psql_in -Atqc "select count(*) from pg_policies where schemaname='public'")
functions=$(psql_in -Atqc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
triggers=$(psql_in -Atqc "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal")
rows=$(psql_in -Atqc "select json_object_agg(relname, n_live_tup order by relname) from pg_stat_user_tables where schemaname='public'")
# ciphertext ต้องเป็น base64 ล้วน ไม่มี plaintext (ตรวจได้โดยไม่ต้องมีกุญแจ)
snapshots=$(psql_in -Atqc "select count(*) from public.ledger_snapshots where cipher !~ '^[A-Za-z0-9+/=]+$'")
# anon ต้องอ่านอะไรไม่ได้เลย
anon_denied=$(psql_in -Atqc "set role anon; select count(*) from (select 1 from public.providers limit 1) x" 2>&1 | grep -c "permission denied" || true)
result=$(printf '{"image":"%s","tables":%s,"tablesWithoutRls":%s,"policies":%s,"functions":%s,"triggers":%s,"nonBase64Snapshots":%s,"anonDenied":%s,"skippedExtensionLines":%s,"rowsPerTable":%s,"at":"%s"}' \
  "$image" "$tables" "$unprotected" "$policies" "$functions" "$triggers" "$snapshots" "$anon_denied" "$skipped" "$rows" "$(date -u +%FT%TZ)")
echo "$result"
[[ -n "$evidence" ]] && echo "$result" > "$evidence"
test "$unprotected" = "0" && test "$snapshots" = "0" && test "$anon_denied" = "1"
echo "restore rehearsal passed on $image: $tables tables, $policies policies, RLS on every table"
