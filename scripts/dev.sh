#!/usr/bin/env bash
#
# Dev launcher: clears leftovers from a previous run (the "[Errno 98] Address
# already in use" cause), then starts backend + frontend in isolated process
# groups so Ctrl-C reaps the whole tree.
#
# Flags / env:
#   --yes / DEV_YES=1   skip the confirmation dialog and kill leftovers
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Load .env for direct runs (when not invoked through the Makefile's export).
set -a; [ -f .env ] && . ./.env; set +a

BACKEND_PORT="${PLOTTER_PORT:-8000}"
FRONTEND_PORT="${VITE_PORT:-5173}"
ASSUME_YES="${DEV_YES:-0}"
[ "${1:-}" = "--yes" ] && ASSUME_YES=1

export PRINTER_SERIAL_ENABLED="${PRINTER_SERIAL_ENABLED:-false}"
export PRINTER_DEFAULT_BACKEND="${PRINTER_DEFAULT_BACKEND:-}"
export PRINTER_SERIAL_PORT="${PRINTER_SERIAL_PORT:-/dev/ttyUSB0}"
export PRINTER_SERIAL_BAUD="${PRINTER_SERIAL_BAUD:-115200}"
DEV_START_BACKEND="${DEV_START_BACKEND:-1}"
DEV_START_FRONTEND="${DEV_START_FRONTEND:-1}"
case "$DEV_START_BACKEND" in 1|true|TRUE|yes|YES|on|ON) DEV_START_BACKEND=1 ;; *) DEV_START_BACKEND=0 ;; esac
case "$DEV_START_FRONTEND" in 1|true|TRUE|yes|YES|on|ON) DEV_START_FRONTEND=1 ;; *) DEV_START_FRONTEND=0 ;; esac

cyan=$'\033[1;36m'; yellow=$'\033[1;33m'; red=$'\033[1;31m'; green=$'\033[1;32m'; dim=$'\033[2m'; reset=$'\033[0m'
say() { printf '%s\n' "$*"; }

OWN_PGID="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"

# --- find leftover processes ------------------------------------------------
# Port holders plus anything matching this project's dev commands. Excludes the
# current shell's process group so we never kill ourselves.
find_leftovers() {
  {
    lsof -ti "tcp:${BACKEND_PORT}" -sTCP:LISTEN 2>/dev/null
    lsof -ti "tcp:${FRONTEND_PORT}" -sTCP:LISTEN 2>/dev/null
    pgrep -f "uvicorn plotter.web.app" 2>/dev/null
    pgrep -f "${ROOT}/frontend/node_modules/.bin/vite" 2>/dev/null
    pgrep -f "${ROOT}/frontend/node_modules/@esbuild" 2>/dev/null
  } | sort -u | while read -r pid; do
    [ -n "$pid" ] || continue
    [ "$pid" = "$$" ] && continue
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [ "$pgid" = "$OWN_PGID" ] && continue
    echo "$pid"
  done | sort -u
}

describe_pid() { ps -o pid=,args= -p "$1" 2>/dev/null | sed 's/  */ /g' | cut -c1-90; }

# Kill the whole process group of each PID (catches uvicorn's reload worker and
# vite's esbuild child, which a bare PID kill would orphan or let respawn).
kill_leftovers() {
  local pids=("$@") pgids=() pid pgid
  for pid in "${pids[@]}"; do
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [ -n "$pgid" ] && [ "$pgid" != "$OWN_PGID" ] && pgids+=("$pgid")
  done
  [ "${#pgids[@]}" -eq 0 ] && return 0
  mapfile -t pgids < <(printf '%s\n' "${pgids[@]}" | sort -u)
  for pgid in "${pgids[@]}"; do kill -TERM -- "-$pgid" 2>/dev/null; done
  # Give them a moment, then make sure the ports are actually free.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! lsof -ti "tcp:${BACKEND_PORT}" -sTCP:LISTEN >/dev/null 2>&1 \
       && ! lsof -ti "tcp:${FRONTEND_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.3
  done
  for pgid in "${pgids[@]}"; do kill -KILL -- "-$pgid" 2>/dev/null; done
  sleep 0.3
}

confirm() { # $1 = message
  [ "$ASSUME_YES" = 1 ] && return 0
  if command -v whiptail >/dev/null 2>&1 && [ -t 0 ] && [ -t 1 ]; then
    whiptail --title "make dev — Aufräumen" --yesno "$1" 20 78
    return $?
  fi
  printf '%s [J/n] ' "$1" >&2
  local ans; read -r ans
  case "$ans" in n|N|no|nein) return 1 ;; *) return 0 ;; esac
}

mapfile -t LEFTOVERS < <(find_leftovers)
if [ "${#LEFTOVERS[@]}" -gt 0 ]; then
  list=""
  for pid in "${LEFTOVERS[@]}"; do list+="  • $(describe_pid "$pid")"$'\n'; done
  say "${yellow}⚠ Reste eines früheren Laufs gefunden (Ports ${BACKEND_PORT}/${FRONTEND_PORT}):${reset}"
  printf '%s%s%s' "$dim" "$list" "$reset"
  if confirm "Diese ${#LEFTOVERS[@]} Prozess(e) beenden, um die Ports freizugeben?"$'\n\n'"$list"; then
    kill_leftovers "${LEFTOVERS[@]}"
    if lsof -ti "tcp:${BACKEND_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      say "${red}✖ Port ${BACKEND_PORT} ist weiterhin belegt — bitte manuell prüfen (lsof -i :${BACKEND_PORT}).${reset}"
      exit 1
    fi
    say "${green}✓ Reste beendet, Ports frei.${reset}"
  else
    say "${red}Abgebrochen — es läuft noch etwas auf den Ports.${reset}"
    exit 1
  fi
fi

# --- start services ---------------------------------------------------------
export PLOTTER_AUTH_DEV_BYPASS=1
if [ "$DEV_START_BACKEND" = 1 ]; then
  say "${cyan}▶ Backend  → http://localhost:${BACKEND_PORT}${reset}"
else
  say "${yellow}○ Backend aus${reset}"
fi
if [ "$DEV_START_FRONTEND" = 1 ]; then
  say "${cyan}▶ Frontend → http://localhost:${FRONTEND_PORT}  (proxy /api → :${BACKEND_PORT})${reset}"
else
  say "${yellow}○ Frontend aus${reset}"
fi

back=; front=
cleanup() {
  trap - INT TERM EXIT
  say ""
  say "${cyan}▶ stoppe Dienste…${reset}"
  [ -n "$back" ]  && kill -TERM -- "-$back"  2>/dev/null
  [ -n "$front" ] && kill -TERM -- "-$front" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup INT TERM EXIT

if [ "$DEV_START_BACKEND" = 1 ]; then
  setsid uv run uvicorn plotter.web.app:app \
    --host 0.0.0.0 \
    --port "$BACKEND_PORT" \
    --reload \
    --reload-dir plotter &
  back=$!
fi

if [ "$DEV_START_FRONTEND" = 1 ]; then
  setsid bash -c 'cd "$1" && exec npm run dev' _ "$ROOT/frontend" &
  front=$!
fi

wait
