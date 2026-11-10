#!/usr/bin/env bash
# Run the browser tests. Each test file gets the app started on its own
# brand-new development database, and the app is stopped afterwards.
#
# Usage: scripts/run-e2e.sh [dev|start] [phase1 phase2 ...]
#   dev    (default) the development server
#   start  a production build (run `npm run build` first)
#   With no test names, every e2e/phase*.cjs file runs, in order.
# Options (environment): PORT (default 3111), SHOTS (screenshot folder),
#   SHOT_SCALE (1 or 2), E2E_LOG (server log file).
set -uo pipefail
cd "$(dirname "$0")/.."

MODE="dev"
if [ "${1:-}" = "dev" ] || [ "${1:-}" = "start" ]; then
  MODE="$1"
  shift
fi
PORT="${PORT:-3111}"

TESTS=("$@")
if [ "${#TESTS[@]}" -eq 0 ]; then
  for file in e2e/phase*.cjs; do
    name="$(basename "$file" .cjs)"
    TESTS+=("$name")
  done
fi

port_in_use() {
  curl -s -o /dev/null "http://localhost:$PORT/login"
}

SERVER=""
stop_server() {
  if [ -n "$SERVER" ]; then
    kill -- -"$SERVER" 2>/dev/null || true
    for _ in $(seq 1 20); do
      port_in_use || break
      sleep 0.5
    done
    SERVER=""
  fi
}
trap stop_server EXIT

FAILED=()
for name in "${TESTS[@]}"; do
  if [ ! -f "e2e/$name.cjs" ]; then
    echo "No such test: e2e/$name.cjs" >&2
    exit 1
  fi
  if port_in_use; then
    echo "Something is already running on port $PORT. Stop it first." >&2
    exit 1
  fi

  DATA=".data/e2e-$(date +%s)-$name"
  mkdir -p "$DATA"
  LOG="${E2E_LOG:-$DATA/server.log}"

  export SEED_OWNERS="Kale <kale@example.com>, Casey <casey@example.com>"
  export PGLITE_DIR="$DATA/db"
  export EMAIL_OUTBOX_DIR="$DATA/outbox"
  export APP_URL="http://localhost:$PORT"
  export NEXT_TELEMETRY_DISABLED=1

  # Job control gives the server its own process group, so stopping it also
  # stops the helper processes it starts.
  set -m
  npx next "$MODE" -p "$PORT" >"$LOG" 2>&1 &
  SERVER=$!
  set +m

  for _ in $(seq 1 60); do
    port_in_use && break
    sleep 1
  done

  echo "== $name"
  if ! BASE_URL="http://localhost:$PORT" OUTBOX="$EMAIL_OUTBOX_DIR" node "e2e/$name.cjs"; then
    FAILED+=("$name")
    echo "(server log: $LOG)"
  fi
  stop_server
done

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "Failed: ${FAILED[*]}"
  exit 1
fi
echo "All browser tests passed."
