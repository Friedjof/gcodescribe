#!/usr/bin/env bash
# Generate Flatpak source JSON files for reproducible offline builds.
#
# Prerequisites (install once):
#   pip install flatpak-builder-tools
#   npm install -g @flatpak-node-generator/npm  # or use flatpak-node-generator
#
# Usage:
#   cd <repo-root>
#   packaging/flatpak/generate-sources.sh
#
# Outputs (commit these to the repository):
#   packaging/flatpak/python3-requirements.json
#   packaging/flatpak/npm-sources.json
#   packaging/flatpak/poppler-sha256.txt  (for manual manifest update)

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FLATPAK_DIR=packaging/flatpak

# ── Python dependencies ───────────────────────────────────────────────────────
echo "==> Generating python3-requirements.json ..."

# Export a requirements.txt from uv (or pip) for flatpak-pip-generator.
uv export --no-dev --no-hashes -o /tmp/gcodescribe-requirements.txt

# flatpak-pip-generator reads requirements.txt and downloads/hashes all wheels.
flatpak-pip-generator \
    --runtime org.gnome.Platform \
    --runtime-version 49 \
    --requirements-file /tmp/gcodescribe-requirements.txt \
    --output "${FLATPAK_DIR}/python3-requirements"

echo "  -> ${FLATPAK_DIR}/python3-requirements.json"

# ── npm dependencies ──────────────────────────────────────────────────────────
echo "==> Generating npm-sources.json ..."

# flatpak-node-generator reads package-lock.json and mirrors all packages.
# Install: pip install flatpak-builder-tools  (includes flatpak-node-generator)
flatpak-node-generator \
    --no-autopatch \
    npm \
    frontend/package-lock.json \
    -o "${FLATPAK_DIR}/npm-sources.json"

echo "  -> ${FLATPAK_DIR}/npm-sources.json"

# ── Poppler SHA256 ────────────────────────────────────────────────────────────
echo "==> Computing Poppler SHA256 ..."

POPPLER_VERSION=24.12.0
POPPLER_URL="https://poppler.freedesktop.org/poppler-${POPPLER_VERSION}.tar.xz"
POPPLER_TARBALL="/tmp/poppler-${POPPLER_VERSION}.tar.xz"

wget -q -O "$POPPLER_TARBALL" "$POPPLER_URL"
POPPLER_SHA256=$(sha256sum "$POPPLER_TARBALL" | cut -d' ' -f1)
echo "$POPPLER_SHA256  poppler-${POPPLER_VERSION}.tar.xz" > "${FLATPAK_DIR}/poppler-sha256.txt"

echo "  -> ${FLATPAK_DIR}/poppler-sha256.txt"
echo "  SHA256: $POPPLER_SHA256"
echo ""
echo "  Update the sha256 in ${FLATPAK_DIR}/info.noweck.gcodescribe.yml:"
echo "    sha256: ${POPPLER_SHA256}"

echo ""
echo "Done. Commit the updated JSON files before building."
