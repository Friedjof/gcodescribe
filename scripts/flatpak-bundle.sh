#!/usr/bin/env bash
# Erstellt GCodeScribe.flatpak — eine verteilbare Einzeldatei.
#
# Dieser Schritt ist bewusst langsam: flatpak build-bundle muss alle
# ~550 MB Python-Pakete per xz komprimieren. Das Bundle ist nur für
# die Weitergabe an andere Rechner nötig. Für lokale Installation:
#   make install   (oder scripts/flatpak-install.sh)
#
# Flags:
#   --clean   erzwingt einen kompletten Neubau
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
REPO_DIR=.flatpak-repo
BUNDLE=GCodeScribe.flatpak

# ── preflight ─────────────────────────────────────────────────────────────────

command -v flatpak-builder >/dev/null 2>&1 \
  || die "flatpak-builder nicht gefunden. Installieren mit: sudo apt install flatpak-builder"

[ -f "$MANIFEST" ] \
  || die "Manifest nicht gefunden: $MANIFEST"

# ── build → OSTree-Repo ───────────────────────────────────────────────────────

BUILDER_ARGS=(--repo="$REPO_DIR")
if [ "$FORCE_CLEAN" = 1 ] || [ -e "$BUILD_DIR" ]; then BUILDER_ARGS+=(--force-clean); fi

step "Baue Flatpak (build-dir: $BUILD_DIR, repo: $REPO_DIR) …"
say "${dim}Das dauert beim ersten Mal einige Minuten.${reset}"

flatpak-builder "${BUILDER_ARGS[@]}" "$BUILD_DIR" "$MANIFEST"

# ── OSTree-Repo → Bundle ──────────────────────────────────────────────────────
# flatpak build-bundle liest alle ~285 MB aus dem OSTree-Repo und komprimiert
# sie per xz in eine Einzeldatei. Das ist der langsame Schritt (~2–5 min).

step "Erstelle Bundle: $BUNDLE …"
say "${dim}(xz-Kompression über ~285 MB OSTree-Objekte — dauert einige Minuten)${reset}"
flatpak build-bundle "$REPO_DIR" "$BUNDLE" info.noweck.gcodescribe

BUNDLE_SIZE=$(du -sh "$BUNDLE" 2>/dev/null | cut -f1)
ok "Bundle erstellt: $BUNDLE ($BUNDLE_SIZE)"
say ""
say "${dim}Installieren auf einem anderen Rechner mit:${reset}"
say "  flatpak install --user $BUNDLE"
