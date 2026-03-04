#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-5175}"

if ! command -v lsof >/dev/null 2>&1; then
  exit 0
fi

PIDS="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
if [ -z "${PIDS}" ]; then
  exit 0
fi

echo "[e2e] freeing port ${PORT} (pids: ${PIDS})"
kill ${PIDS} 2>/dev/null || true
sleep 0.4

PIDS_LEFT="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "${PIDS_LEFT}" ]; then
  echo "[e2e] force-killing remaining pids on ${PORT}: ${PIDS_LEFT}"
  kill -9 ${PIDS_LEFT} 2>/dev/null || true
fi
