#!/usr/bin/env bash
set -euo pipefail
umask 077

database_url=${OPERATIONS_DATABASE_URL:-${SUPABASE_DATABASE_URL:-}}
output_path=${1:-usage-events-real.csv}
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
output_dir=$(dirname "$output_path")
mkdir -p "$output_dir"
temporary_dir=$(mktemp -d "$output_dir/.usage-export.XXXXXX")
temporary_path="$temporary_dir/usage-events.csv"
json_path="$temporary_dir/query.json"
cleanup() {
  [[ ! -f "$temporary_path" ]] || unlink "$temporary_path"
  [[ ! -f "$json_path" ]] || unlink "$json_path"
  rmdir "$temporary_dir" 2>/dev/null || true
}
trap cleanup EXIT

query="select teacher_id as random_id, event, count, at
         from public.usage_events
        where mode = 'real'
        order by at"

if [[ -n "$database_url" ]] && command -v psql >/dev/null 2>&1; then
  PGDATABASE="$database_url" PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on" \
    psql -X --csv -v ON_ERROR_STOP=1 -c "$query" > "$temporary_path"
elif command -v supabase >/dev/null 2>&1; then
  # Supabase CLI writes progress to stderr. Only its JSON stdout enters the parser,
  # so "Initialising login role..." can never corrupt the CSV artifact.
  supabase db query --linked "$query" --output-format json --workdir "$repo_dir" > "$json_path"
  node "$repo_dir/scripts/usage-events-json-to-csv.mjs" < "$json_path" > "$temporary_path"
else
  echo "Set a database URL with psql installed, or install/login/link the Supabase CLI." >&2
  exit 1
fi

mv "$temporary_path" "$output_path"
[[ ! -f "$json_path" ]] || unlink "$json_path"
rmdir "$temporary_dir"
trap - EXIT
echo "Exported real-mode aggregate usage rows to $output_path"
