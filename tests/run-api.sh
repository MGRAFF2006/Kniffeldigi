#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

port="${TEST_PORT:-18788}"
export BASE="http://127.0.0.1:$port"
export WRANGLER_SEND_METRICS=false
if curl --silent --max-time 1 "$BASE" >/dev/null; then
  echo "Test-Port $port ist bereits belegt. TEST_PORT auf einen freien Port setzen." >&2
  exit 1
fi

test_dir="$(mktemp -d)"
server_pid=''
cleanup() {
  local result=$?
  trap - EXIT
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [ "$result" -ne 0 ]; then cat "$test_dir/server.log"; fi
  rm -rf "$test_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

node node_modules/wrangler/bin/wrangler.js dev --local --ip 127.0.0.1 --port "$port" \
  --persist-to "$test_dir/state" > "$test_dir/server.log" 2>&1 &
server_pid=$!
# Nur der hier gestartete Server zählt: Er muss laufen und selbst "Ready" auf diesem Port melden.
# Ein fremder Prozess auf demselben Port (z. B. ein parallel gestarteter Testlauf) reicht nicht.
ready=''
for ((attempt = 0; attempt < 60; attempt++)); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Testserver wurde beendet, bevor er bereit war." >&2
    exit 1
  fi
  if grep -Eq "Ready on http://[^ ]+:$port([^0-9]|$)" "$test_dir/server.log" \
    && curl --fail --silent --max-time 1 "$BASE" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "Testserver wurde nicht innerhalb von 60 s bereit." >&2
  exit 1
fi
node tests/api.test.mjs
