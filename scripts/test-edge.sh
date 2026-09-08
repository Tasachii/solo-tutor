#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
docker run --rm --env LINE_ALLOWED_ORIGIN=https://solo.example \
  --env PUBLIC_RATE_LIMIT_SECRET=local-test-rate-limit-secret-32-bytes \
  --volume "$repo_dir:/work:ro" --workdir /work denoland/deno:2.4.5 \
  deno test --no-config --no-lock --allow-import \
  --allow-env=LINE_ALLOWED_ORIGIN,PUBLIC_RATE_LIMIT_SECRET \
  --allow-read=/work/supabase/config.toml \
  tests/edge/
