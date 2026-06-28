#!/usr/bin/env bash
set -e

CLOUDBANANA_DIR="/etc/cloudbanana"
PID_FILE="$CLOUDBANANA_DIR/cloudbanana.pid"
LOG_FILE="/var/log/cloudbanana.log"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="0.1.0"

case "$1" in
  start)
    echo "Starting CloudBanana DE v$VERSION ..."
    mkdir -p "$CLOUDBANANA_DIR"
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "CloudBanana DE is already running (PID $(cat "$PID_FILE"))"
      exit 1
    fi
    cd "$PROJECT_DIR/backend"
    nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "CloudBanana DE started on http://0.0.0.0:8000"
    echo "Logs: $LOG_FILE"
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      echo "Stopping CloudBanana DE (PID $PID) ..."
      kill "$PID" 2>/dev/null || true
      rm -f "$PID_FILE"
      echo "CloudBanana DE stopped"
    else
      echo "CloudBanana DE is not running"
    fi
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "CloudBanana DE is running (PID $(cat "$PID_FILE"))"
    else
      echo "CloudBanana DE is not running"
    fi
    ;;
  -v|--version|version)
    echo "CloudBanana DE v$VERSION"
    ;;
  *)
    echo "CloudBanana DE v$VERSION — Lightweight VPS Desktop Environment"
    echo ""
    echo "Usage: cloudbanana {start|stop|restart|status|-v}"
    ;;
esac
