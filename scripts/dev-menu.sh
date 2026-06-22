#!/usr/bin/env bash
# Interactive dev launcher for `make dev`.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

set -a; [ -f .env ] && . ./.env; set +a

cyan=$'\033[1;36m'; yellow=$'\033[1;33m'; red=$'\033[1;31m'; green=$'\033[1;32m'; dim=$'\033[2m'; reset=$'\033[0m'
say() { printf '%s\n' "$*"; }

truthy() {
  case "${1:-}" in 1|true|TRUE|yes|YES|on|ON) return 0 ;; *) return 1 ;; esac
}

DEV_REDIS="${DEV_REDIS:-1}"
DEV_START_BACKEND="${DEV_START_BACKEND:-1}"
DEV_START_FRONTEND="${DEV_START_FRONTEND:-1}"
DEV_RUN_TESTS="${DEV_RUN_TESTS:-0}"
DEV_RUN_RUFF="${DEV_RUN_RUFF:-0}"
DEV_BUILD_FRONTEND="${DEV_BUILD_FRONTEND:-0}"
PRINTER_SERIAL_ENABLED="${PRINTER_SERIAL_ENABLED:-false}"
PRINTER_DEFAULT_BACKEND="${PRINTER_DEFAULT_BACKEND:-}"
PRINTER_SERIAL_PORT="${PRINTER_SERIAL_PORT:-/dev/ttyUSB0}"
PRINTER_SERIAL_BAUD="${PRINTER_SERIAL_BAUD:-115200}"
PLOTTER_PORT="${PLOTTER_PORT:-8010}"

onoff() { truthy "$1" && printf on || printf off; }
bool_to_status() { truthy "$1" && printf ON || printf OFF; }

print_header() {
  say "${cyan}╭────────────────────────────────────────────╮${reset}"
  say "${cyan}│ GCodeScribe Dev Cockpit                    │${reset}"
  say "${cyan}╰────────────────────────────────────────────╯${reset}"
}

show_summary() {
  say "${dim}Services:${reset} Redis $(bool_to_status "$DEV_REDIS") · Backend $(bool_to_status "$DEV_START_BACKEND") :${PLOTTER_PORT} · Frontend $(bool_to_status "$DEV_START_FRONTEND")"
  say "${dim}Serial:${reset} enabled=${PRINTER_SERIAL_ENABLED} · default=${PRINTER_DEFAULT_BACKEND:-auto} · port=${PRINTER_SERIAL_PORT} · baud=${PRINTER_SERIAL_BAUD}"
  say "${dim}Checks:${reset} tests $(bool_to_status "$DEV_RUN_TESTS") · ruff $(bool_to_status "$DEV_RUN_RUFF") · frontend build $(bool_to_status "$DEV_BUILD_FRONTEND")"
}

plain_summary() {
  printf 'Services: Redis %s · Backend %s :%s · Frontend %s\n' "$(bool_to_status "$DEV_REDIS")" "$(bool_to_status "$DEV_START_BACKEND")" "$PLOTTER_PORT" "$(bool_to_status "$DEV_START_FRONTEND")"
  printf 'Serial: enabled=%s · default=%s · port=%s · baud=%s\n' "$PRINTER_SERIAL_ENABLED" "${PRINTER_DEFAULT_BACKEND:-auto}" "$PRINTER_SERIAL_PORT" "$PRINTER_SERIAL_BAUD"
  printf 'Checks: tests %s · ruff %s · frontend build %s\n' "$(bool_to_status "$DEV_RUN_TESTS")" "$(bool_to_status "$DEV_RUN_RUFF")" "$(bool_to_status "$DEV_BUILD_FRONTEND")"
}

toggle() {
  local name="$1"
  if truthy "${!name:-0}"; then
    printf -v "$name" '%s' 0
  else
    printf -v "$name" '%s' 1
  fi
}

configure_serial_text() {
  local ans
  printf 'Serial backend aktivieren? [j/N] '; read -r ans
  case "$ans" in j|J|y|Y|yes|YES) PRINTER_SERIAL_ENABLED=true ;; *) PRINTER_SERIAL_ENABLED=false ;; esac
  printf 'Default backend (leer=auto, octoprint, serial) [%s]: ' "${PRINTER_DEFAULT_BACKEND:-}"
  read -r ans; [ -n "$ans" ] && PRINTER_DEFAULT_BACKEND="$ans"
  printf 'Serial-Port [%s]: ' "$PRINTER_SERIAL_PORT"
  read -r ans; [ -n "$ans" ] && PRINTER_SERIAL_PORT="$ans"
  printf 'Baudrate [%s]: ' "$PRINTER_SERIAL_BAUD"
  read -r ans; [ -n "$ans" ] && PRINTER_SERIAL_BAUD="$ans"
}

configure_serial_whiptail() {
  local enabled default_backend port baud
  if whiptail --title "Serial" --yesno "USB-Serial-Backend aktivieren?" 9 62; then
    enabled=true
  else
    enabled=false
  fi
  default_backend=$(whiptail --title "Serial" --inputbox "Default backend (leer=auto, octoprint, serial)" 9 70 "${PRINTER_DEFAULT_BACKEND:-}" 3>&1 1>&2 2>&3) || return 0
  port=$(whiptail --title "Serial" --inputbox "Serial-Port" 9 70 "$PRINTER_SERIAL_PORT" 3>&1 1>&2 2>&3) || return 0
  baud=$(whiptail --title "Serial" --inputbox "Baudrate" 9 70 "$PRINTER_SERIAL_BAUD" 3>&1 1>&2 2>&3) || return 0
  PRINTER_SERIAL_ENABLED="$enabled"
  PRINTER_DEFAULT_BACKEND="$default_backend"
  PRINTER_SERIAL_PORT="$port"
  PRINTER_SERIAL_BAUD="$baud"
}

run_preflight() {
  if truthy "$DEV_RUN_RUFF"; then
    say "${cyan}▶ Ruff${reset}"
    uv run ruff check plotter tests || exit 1
  fi
  if truthy "$DEV_RUN_TESTS"; then
    say "${cyan}▶ Tests${reset}"
    uv run pytest || exit 1
  fi
  if truthy "$DEV_BUILD_FRONTEND"; then
    say "${cyan}▶ Frontend build${reset}"
    (cd frontend && npm run build) || exit 1
  fi
}

start_dev() {
  if ! truthy "$DEV_START_BACKEND" && ! truthy "$DEV_START_FRONTEND"; then
    say "${red}✖ Backend und Frontend sind beide aus. Nichts zu starten.${reset}"
    return 1
  fi
  export DEV_START_BACKEND DEV_START_FRONTEND
  export PLOTTER_PORT
  export PRINTER_SERIAL_ENABLED PRINTER_DEFAULT_BACKEND PRINTER_SERIAL_PORT PRINTER_SERIAL_BAUD
  run_preflight
  if truthy "$DEV_REDIS"; then
    make redis || true
  fi
  say "${green}▶ Starte Dev-Stack…${reset}"
  exec bash scripts/dev.sh --yes
}

whiptail_menu() {
  while true; do
    local choice
    choice=$(whiptail --title "GCodeScribe Dev Cockpit" --menu \
      "Services, Checks und Printer-Env einstellen" 22 78 12 \
      start "Dev-Stack starten" \
      redis "Redis: $(bool_to_status "$DEV_REDIS")" \
      backend "Backend: $(bool_to_status "$DEV_START_BACKEND")" \
      frontend "Frontend: $(bool_to_status "$DEV_START_FRONTEND")" \
      serial "Serial konfigurieren" \
      testsnow "Tests jetzt ausführen" \
      tests "Tests vor Start: $(bool_to_status "$DEV_RUN_TESTS")" \
      ruff "Ruff vor Start: $(bool_to_status "$DEV_RUN_RUFF")" \
      build "Frontend-Build vor Start: $(bool_to_status "$DEV_BUILD_FRONTEND")" \
      summary "Aktuelle Einstellungen anzeigen" \
      quit "Abbrechen" 3>&1 1>&2 2>&3) || exit 0
    case "$choice" in
      start) start_dev ;;
      redis) toggle DEV_REDIS ;;
      backend) toggle DEV_START_BACKEND ;;
      frontend) toggle DEV_START_FRONTEND ;;
      serial) configure_serial_whiptail ;;
      testsnow) uv run pytest || whiptail --title "Tests" --msgbox "Tests fehlgeschlagen." 8 48 ;;
      tests) toggle DEV_RUN_TESTS ;;
      ruff) toggle DEV_RUN_RUFF ;;
      build) toggle DEV_BUILD_FRONTEND ;;
      summary) whiptail --title "Aktuelle Einstellungen" --msgbox "$(plain_summary)" 12 78 ;;
      quit) exit 0 ;;
    esac
  done
}

text_menu() {
  while true; do
    clear 2>/dev/null || true
    print_header
    show_summary
    say ""
    say "1) Dev-Stack starten"
    say "2) Redis toggeln"
    say "3) Backend toggeln"
    say "4) Frontend toggeln"
    say "5) Serial konfigurieren"
    say "6) Tests jetzt ausführen"
    say "7) Tests vor Start toggeln"
    say "8) Ruff vor Start toggeln"
    say "9) Frontend-Build vor Start toggeln"
    say "0) Abbrechen"
    printf '\nAuswahl: '
    local choice; read -r choice
    case "$choice" in
      1) start_dev ;;
      2) toggle DEV_REDIS ;;
      3) toggle DEV_START_BACKEND ;;
      4) toggle DEV_START_FRONTEND ;;
      5) configure_serial_text ;;
      6) uv run pytest; printf '\nEnter zum Weiter… '; read -r _ ;;
      7) toggle DEV_RUN_TESTS ;;
      8) toggle DEV_RUN_RUFF ;;
      9) toggle DEV_BUILD_FRONTEND ;;
      0) exit 0 ;;
    esac
  done
}

if command -v whiptail >/dev/null 2>&1 && [ -t 0 ] && [ -t 1 ]; then
  whiptail_menu
else
  text_menu
fi
