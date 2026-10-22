#!/usr/bin/env bash
# Builds the single-file web command center and stages it into the Android assets.
#
# The PGlite runtime is split out of index.html and gitignored, so this has to run
# before any local :app:assembleDebug. CI calls the same script, which is what
# keeps local and CI builds byte-identical.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS="$ROOT/public/android/HeretIc/app/src/main/assets"

cd "$ROOT/webui"
npm ci
npm run typecheck
npm run build

mkdir -p "$ASSETS"
rm -f "$ASSETS"/*.js "$ASSETS"/*.wasm "$ASSETS"/*.data
cp dist/* "$ASSETS"/

echo "staged $(ls -1 "$ASSETS" | wc -l) files into public/android/HeretIc/app/src/main/assets:"
ls -la "$ASSETS"
