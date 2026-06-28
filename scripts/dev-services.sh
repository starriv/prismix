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

# Read PORT, VITE_DEV_PORT, WORKER_HEALTH_PORT from env, .env.local, or .env.example
for VAR in PORT VITE_DEV_PORT WORKER_HEALTH_PORT; do
  if [ -z "$(eval echo "\${${VAR}:-}")" ] && [ -f "$PROJECT_ROOT/.env.local" ]; then
    eval "$VAR=$(grep -m1 "^${VAR}=" "$PROJECT_ROOT/.env.local" | cut -d= -f2)"
  fi
  if [ -z "$(eval echo "\${${VAR}:-}")" ] && [ -f "$PROJECT_ROOT/.env.example" ]; then
    eval "$VAR=$(grep -m1 "^${VAR}=" "$PROJECT_ROOT/.env.example" | cut -d= -f2)"
  fi
done
APP_PORT="${PORT:?ERROR: PORT not found in env, .env.local, or .env.example}"
DEV_PORT="${VITE_DEV_PORT:-}"
WORKER_PORT="${WORKER_HEALTH_PORT:-3404}"
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
    kill_port "$APP_PORT" 2>/dev/null || true
    [ -n "$DEV_PORT" ] && kill_port "$DEV_PORT" 2>/dev/null || true
    kill_port "$WORKER_PORT" 2>/dev/null || true
    docker compose -f "$COMPOSE_FILE" down
    ;;
  status)
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  reset)
    echo "This will DELETE all PostgreSQL + Redis data."
    kill_port "$APP_PORT" 2>/dev/null || true
    [ -n "$DEV_PORT" ] && kill_port "$DEV_PORT" 2>/dev/null || true
    kill_port "$WORKER_PORT" 2>/dev/null || true
    docker compose -f "$COMPOSE_FILE" down -v
    echo "Volumes removed."
    ;;
  start)
    # 1. Kill stale processes on APP_PORT, DEV_PORT, and WORKER_PORT (e.g. leftover tsx/vite/worker from previous dev session)
    if ! port_free "$APP_PORT"; then
      kill_port "$APP_PORT"
    fi
    if [ -n "$DEV_PORT" ] && ! port_free "$DEV_PORT"; then
      kill_port "$DEV_PORT"
    fi
    if ! port_free "$WORKER_PORT"; then
      kill_port "$WORKER_PORT"
    fi

    # 2. Start PG + Redis via docker compose (--wait blocks until healthy)
    docker compose -f "$COMPOSE_FILE" up -d --wait

    # 3. Verify all dependent ports are reachable
    FAILED=""
    port_free 15433 && FAILED="${FAILED} PG:15433"
    port_free 16378 && FAILED="${FAILED} Redis:16378"

    if [ -n "$FAILED" ]; then
      echo "ERROR: Services not listening:$FAILED"
      exit 1
    fi

    echo ""
    echo "  All services healthy and ports verified."
    echo "  DATABASE_URL=postgresql://prismix:prismix@localhost:15433/prismix"
    echo "  REDIS_URL=redis://localhost:16378"
    echo ""
    ;;
  *)
    echo "Usage: $0 [start|stop|status|reset]"
    exit 1
    ;;
esac
