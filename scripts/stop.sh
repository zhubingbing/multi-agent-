#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUN_DIR="$ROOT/.run"
if command -v systemctl >/dev/null 2>&1 && systemctl cat multi-agent-web.service >/dev/null 2>&1; then
  systemctl stop multi-agent-web.service
else
  tmux kill-session -t multi-agent-web 2>/dev/null || true
fi
for name in runtime-host control; do
  file="$RUN_DIR/$name.pid"
  [[ -f "$file" ]] || continue
  pid=$(cat "$file")
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
done
docker-compose -f "$ROOT/compose.yaml" down
