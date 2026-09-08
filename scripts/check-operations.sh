#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
: "${OPERATIONS_DATABASE_URL:?Set OPERATIONS_DATABASE_URL to a read-only PostgreSQL connection string}"

psql "$OPERATIONS_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f "$script_dir/check-operations.sql"
