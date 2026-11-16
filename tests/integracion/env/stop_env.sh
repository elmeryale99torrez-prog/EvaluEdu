#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="/tmp/evaluedu_rc_runtime"
PG_DIR="${WORK_DIR}/pg"
PID_DIR="${WORK_DIR}/pids"

if [[ -d "${PID_DIR}" ]]; then
  for pidfile in "${PID_DIR}"/*.pid; do
    [[ -e "${pidfile}" ]] || continue
    pid="$(cat "${pidfile}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
  sleep 0.5
  for pidfile in "${PID_DIR}"/*.pid; do
    [[ -e "${pidfile}" ]] || continue
    pid="$(cat "${pidfile}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill -9 "${pid}" 2>/dev/null || true
    fi
  done
fi

if [[ -d "${PG_DIR}" ]] && [[ -f "${PG_DIR}/postmaster.pid" ]]; then
  /usr/lib/postgresql/15/bin/pg_ctl -D "${PG_DIR}" stop -m fast >/dev/null 2>&1 || true
fi

if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "${WORK_DIR}"
fi

echo "STOP_ENV: OK"
