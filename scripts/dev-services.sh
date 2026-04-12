#!/usr/bin/env bash
# ── Start/stop dev services via docker compose ──────────────────────
#
# Usage:
#   ./scripts/dev-services.sh          # start (kill stale app, start PG+Redis, wait healthy)
#   ./scripts/dev-services.sh stop     # stop  (docker compose down)
#   ./scripts/dev-services.sh status   # show  (docker compose ps)
#   ./scripts/dev-services.sh reset    # wipe  (docker compose down -v)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
APP_PORT="${PORT:?ERROR: PORT env var is required (e.g. export PORT=3403)}"
ACTION="${1:-start}"

# ── Helpers ──────────────────────────────────────────────────────────

# Kill any process occupying a given port
kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Port $port is occupied — killing PID(s): $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
}

# Check if a port is free (returns 0 if free, 1 if occupied)
port_free() {
  ! lsof -ti :"$1" &>/dev/null
}

# ── Actions ──────────────────────────────────────────────────────────

case "$ACTION" in
  stop)
    docker compose -f "$COMPOSE_FILE" down
    ;;
  status)
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  reset)
    echo "This will DELETE all PostgreSQL + Redis data."
    docker compose -f "$COMPOSE_FILE" down -v
    echo "Volumes removed."
    ;;
  start)
    # 1. Kill stale app process on APP_PORT (e.g. leftover tsx from previous dev session)
    if ! port_free "$APP_PORT"; then
      kill_port "$APP_PORT"
    fi

    # 2. Start PG + Redis via docker compose (--wait blocks until healthy)
    docker compose -f "$COMPOSE_FILE" up -d --wait

    # 3. Verify all dependent ports are reachable
    FAILED=""
    port_free 15432 && FAILED="${FAILED} PG:15432"
    port_free 16379 && FAILED="${FAILED} Redis:16379"

    if [ -n "$FAILED" ]; then
      echo "ERROR: Services not listening:$FAILED"
      exit 1
    fi

    echo ""
    echo "  All services healthy and ports verified."
    echo "  DATABASE_URL=postgresql://prismix:prismix@localhost:15432/prismix"
    echo "  REDIS_URL=redis://localhost:16379"
    echo ""
    ;;
  *)
    echo "Usage: $0 [start|stop|status|reset]"
    exit 1
    ;;
esac
