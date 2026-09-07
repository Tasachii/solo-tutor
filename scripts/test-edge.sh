#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
docker run --rm --env LINE_ALLOWED_ORIGIN=https://solo.example \
  --volume "$repo_dir:/work:ro" --workdir /work denoland/deno:2.4.5 \
  deno test --no-config --no-lock --allow-import --allow-env=LINE_ALLOWED_ORIGIN \
  --allow-read=/work/supabase/config.toml \
  tests/edge/
