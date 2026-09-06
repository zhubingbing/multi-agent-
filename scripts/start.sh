#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUN_DIR="$ROOT/.run"
BIN_DIR="$ROOT/.bin"
mkdir -p "$RUN_DIR" "$BIN_DIR"

stop_pid() {
  local file=$1
  if [[ -f "$file" ]]; then
    local pid
    pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

stop_pid "$RUN_DIR/web.pid"
stop_pid "$RUN_DIR/control.pid"
stop_pid "$RUN_DIR/runtime-host.pid"

cd "$ROOT/services/pi-host"
[[ -d node_modules ]] || npm install
npm run build
PI_SDK_VERSION=$(node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version")
export MULTI_AGENT_PI_VERSION="$PI_SDK_VERSION"

cd "$ROOT/apps/pi-web"
[[ -d node_modules ]] || npm ci --ignore-scripts

cd "$ROOT"
go build -o "$BIN_DIR/control" ./cmd/control
go build -o "$BIN_DIR/runtime" ./cmd/runtime

nohup "$BIN_DIR/control" -addr 0.0.0.0:30146 -web-upstream http://127.0.0.1:30148 >"$RUN_DIR/control.log" 2>&1 &
echo $! >"$RUN_DIR/control.pid"

for _ in $(seq 1 80); do
  curl -fsS http://127.0.0.1:30146/api/multi-agent/healthz >/dev/null 2>&1 && break
  sleep .25
done

nohup "$BIN_DIR/runtime" \
  -server ws://127.0.0.1:30146/api/multi-agent/runtime/ws \
  -runtime-id runtime-host \
  -runtime-name "Host Runtime" \
  -pi-version "$PI_SDK_VERSION" \
  -agent-id host-pi \
  -agent-name "Host Pi" \
  -cwd "$ROOT" \
  -root "$ROOT" \
  >"$RUN_DIR/runtime-host.log" 2>&1 &
echo $! >"$RUN_DIR/runtime-host.pid"

docker-compose -f "$ROOT/compose.yaml" up -d

# Next dev owns a child process and its .next lock. Prefer systemd so the web
# process is restarted if the host reaps or crashes it; fall back to tmux on
# development machines without systemd.
if command -v systemctl >/dev/null 2>&1 && systemctl cat multi-agent-web.service >/dev/null 2>&1; then
  systemctl restart multi-agent-web.service
  systemctl show multi-agent-web.service -p MainPID --value >"$RUN_DIR/web.pid"
else
  tmux kill-session -t multi-agent-web 2>/dev/null || true
  tmux new-session -d -s multi-agent-web -c "$ROOT/apps/pi-web" \
    "env PI_WEB_NO_OPEN=1 ./node_modules/.bin/next dev -H 127.0.0.1 -p 30148 >>'$RUN_DIR/web.log' 2>&1"
  tmux list-panes -t multi-agent-web -F '#{pane_pid}' >"$RUN_DIR/web.pid"
fi

ready_count=0
for _ in $(seq 1 180); do
  if curl -fsS http://127.0.0.1:30146/conversations >/dev/null 2>&1; then
    ready_count=$((ready_count + 1))
    if [[ $ready_count -ge 2 ]]; then
      echo "Multi Agent: http://127.0.0.1:30146/conversations"
      echo "Diagnostic: http://127.0.0.1:30146/group"
      echo "Control API: http://127.0.0.1:30146/api/multi-agent/agents"
      exit 0
    fi
  else
    ready_count=0
  fi
  sleep 1
done

echo "Web did not become ready; see $RUN_DIR/web.log" >&2
exit 1
