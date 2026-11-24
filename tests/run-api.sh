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
for ((attempt = 0; attempt < 60; attempt++)); do
  if curl --fail --silent --max-time 1 "$BASE" >/dev/null; then break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then exit 1; fi
  sleep 1
done
curl --fail --silent --max-time 1 "$BASE" >/dev/null
node tests/api.test.mjs
