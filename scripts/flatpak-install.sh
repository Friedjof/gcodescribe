#!/usr/bin/env bash
# Baut und installiert GCodeScribe direkt als Flatpak — kein Bundle-Schritt.
#
# Das ist der schnelle Weg für lokale Entwicklung: flatpak-builder baut
# inkrementell aus dem Cache und installiert direkt, ohne vorher eine
# ~200–400 MB große .flatpak-Datei per xz zu komprimieren.
#
# Für eine verteilbare .flatpak-Datei: make bundle
#
# Flags:
#   --clean   erzwingt einen kompletten Neubau (leert .flatpak-build/)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cyan=$'\033[1;36m'; yellow=$'\033[1;33m'; red=$'\033[1;31m'; green=$'\033[1;32m'; dim=$'\033[2m'; reset=$'\033[0m'
say()  { printf '%s\n' "$*"; }
step() { say "${cyan}▶ $*${reset}"; }
ok()   { say "${green}✓ $*${reset}"; }
warn() { say "${yellow}⚠ $*${reset}"; }
die()  { say "${red}✖ $*${reset}" >&2; exit 1; }

FORCE_CLEAN=0
for arg in "$@"; do
  [ "$arg" = "--clean" ] && FORCE_CLEAN=1
done

MANIFEST=packaging/flatpak/info.noweck.gcodescribe.yml
BUILD_DIR=.flatpak-build
APP_ID=info.noweck.gcodescribe

# ── preflight ─────────────────────────────────────────────────────────────────

command -v flatpak-builder >/dev/null 2>&1 \
  || die "flatpak-builder nicht gefunden. Installieren mit: sudo apt install flatpak-builder"

[ -f "$MANIFEST" ] \
  || die "Manifest nicht gefunden: $MANIFEST"

# ── build + install ────────────────────────────────────────────────────────────

BUILDER_ARGS=(--user --install)
# Auto-clean when the app-dir already exists (e.g. leftover .gitignore from a
# previous build); flatpak-builder treats any file there as "not empty".
if [ "$FORCE_CLEAN" = 1 ] || [ -e "$BUILD_DIR" ]; then BUILDER_ARGS+=(--force-clean); fi

step "Baue und installiere $APP_ID …"
say "${dim}Beim ersten Mal dauert das einige Minuten (Python-Pakete werden geladen).${reset}"
say "${dim}Folgebuilds nutzen den Cache unter .flatpak-builder/cache/.${reset}"

flatpak-builder "${BUILDER_ARGS[@]}" "$BUILD_DIR" "$MANIFEST"

ok "Installiert: $APP_ID"
say ""
say "${dim}Starten mit:${reset}"
say "  flatpak run $APP_ID"
