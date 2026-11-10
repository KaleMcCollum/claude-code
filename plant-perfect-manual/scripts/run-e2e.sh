#!/usr/bin/env bash
# Start the app with a brand-new development database, run the browser test
# against it, then stop the app. Usage: scripts/run-e2e.sh [dev|start]
#   dev   (default) the development server
#   start a production build (run `npm run build` first)
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-dev}"
PORT="${PORT:-3111}"
RUN="$(date +%s)"
DATA=".data/e2e-$RUN"
LOG="${E2E_LOG:-$DATA/server.log}"
mkdir -p "$DATA"

export SEED_OWNERS="Kale <kale@example.com>, Casey <casey@example.com>"
export PGLITE_DIR="$DATA/db"
export EMAIL_OUTBOX_DIR="$DATA/outbox"
export APP_URL="http://localhost:$PORT"
export NEXT_TELEMETRY_DISABLED=1

if curl -s -o /dev/null "http://localhost:$PORT/login"; then
  echo "Something is already running on port $PORT. Stop it first." >&2
  exit 1
fi

# Job control gives the server its own process group, so stopping it at the
# end also stops the helper processes it starts.
set -m
npx next "$MODE" -p "$PORT" >"$LOG" 2>&1 &
SERVER=$!
set +m
trap 'kill -- -"$SERVER" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:$PORT/login"; then break; fi
  sleep 1
done

BASE_URL="http://localhost:$PORT" OUTBOX="$EMAIL_OUTBOX_DIR" node e2e/phase1.cjs
