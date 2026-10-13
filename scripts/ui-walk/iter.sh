#!/usr/bin/env bash
# Builds the client into a private folder (dist/client is left alone) and walks a few steps of one part, for looking at a stylesheet while it is being written.
#   bash scripts/ui-walk/iter.sh <look> <part> <steps|all> [out]       e.g.  bash scripts/ui-walk/iter.sh polish tv-hd 02-home,04-rail-open
# (the signed-in parts need their set-up step: pass "all" for them, or the steps of the set-up too)
# SCAN=1 bash scripts/ui-walk/iter.sh ...   also measures every picture (into .ui-polish/scan/<look>/); then: node scripts/ui-walk/drift.mjs --look=<look> --out=.ui-polish/drift
set -e
cd "$(dirname "$0")/../.."
look="${1:-polish}"; part="${2:-tv-hd}"; steps="${3:-02-home}"; out="${4:-.ui-polish/iter/$look}"
only=(--steps="$steps"); [ "$steps" = "all" ] && only=()
node node_modules/vite/bin/vite.js build --outDir .ui-polish/dist-iter --emptyOutDir > /dev/null
CLIENT_DIR=.ui-polish/dist-iter node scripts/ui-walk/run.mjs --ui="$look" --no-build --only="$part" "${only[@]}" ${SCAN:+--scan} --out="$out" --port=$((9100 + RANDOM % 800)) | grep -v "^===" || true
