#!/usr/bin/env bash
# Build a distributable package (deb, rpm, or appimage) for gcodescribe.
# Used by both `make deb/rpm/appimage` (via Docker) and the CI pipeline.
#
# Usage: build-pkg.sh <deb|rpm|appimage> [VERSION]
set -euo pipefail

FORMAT="${1:?Usage: build-pkg.sh <deb|rpm|appimage> [VERSION]}"
VERSION="${2:-$(grep '^version' pyproject.toml | sed 's/version = "\(.*\)"/\1/')}"

# Build the frontend if the static dir is missing or empty
if [ ! -f plotter/web/static/index.html ]; then
  printf '▶ Building frontend…\n'
  (cd frontend && npm ci --silent && npm run build)
fi

rm -rf staging AppDir appimagetool-x86_64.AppImage

STAGING="$(pwd)/staging"
VENV="$STAGING/usr/lib/gcodescribe"

printf '▶ Installing into staging venv…\n'
python3.12 -m venv "$VENV"
"$VENV/bin/pip" install --quiet .

mkdir -p "$STAGING/usr/bin"
for cmd in gcodescribe gcodescribe-web gcodescribe-desktop; do
  printf '#!/bin/sh\nexec /usr/lib/gcodescribe/bin/%s "$@"\n' "$cmd" \
    > "$STAGING/usr/bin/$cmd"
  chmod +x "$STAGING/usr/bin/$cmd"
done

install -Dm644 packaging/flatpak/info.noweck.gcodescribe.desktop \
  "$STAGING/usr/share/applications/info.noweck.gcodescribe.desktop"
install -Dm644 packaging/flatpak/info.noweck.gcodescribe.svg \
  "$STAGING/usr/share/icons/hicolor/scalable/apps/info.noweck.gcodescribe.svg"
install -Dm644 packaging/flatpak/info.noweck.gcodescribe.metainfo.xml \
  "$STAGING/usr/share/metainfo/info.noweck.gcodescribe.metainfo.xml"

FPM_COMMON=(
  -n gcodescribe
  --version "$VERSION"
  --description "GCodeScribe — convert documents into pen-plotter G-code"
  --url "https://github.com/Friedjof/gcodescribe"
  --maintainer "Friedjof Noweck <dev@noweck.info>"
  --license MIT
  -C staging usr/
)

case "$FORMAT" in
  deb)
    printf '▶ Building .deb…\n'
    fpm -s dir -t deb \
      --depends libgtk-4-1 \
      --depends libwebkit2gtk-4.1-0 \
      --depends python3.12 \
      "${FPM_COMMON[@]}"
    ;;
  rpm)
    printf '▶ Building .rpm…\n'
    fpm -s dir -t rpm \
      --depends gtk4 \
      --depends webkitgtk6.0 \
      --depends python3.12 \
      "${FPM_COMMON[@]}"
    ;;
  appimage)
    printf '▶ Building AppImage…\n'
    wget -q \
      https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
    chmod +x appimagetool-x86_64.AppImage

    cp -a staging/. AppDir/
    cp packaging/flatpak/info.noweck.gcodescribe.desktop AppDir/gcodescribe.desktop
    # Icon filename must match the Icon= field in the desktop file
    cp packaging/flatpak/info.noweck.gcodescribe.svg AppDir/info.noweck.gcodescribe.svg
    printf '#!/bin/sh\nexec "$APPDIR/usr/lib/gcodescribe/bin/gcodescribe-desktop" "$@"\n' \
      > AppDir/AppRun
    chmod +x AppDir/AppRun

    ARCH=x86_64 VERSION="$VERSION" \
      ./appimagetool-x86_64.AppImage --appimage-extract-and-run AppDir \
      "GCodeScribe-${VERSION}-x86_64.AppImage"
    ;;
  *)
    printf 'error: unknown format "%s" (use deb, rpm, or appimage)\n' "$FORMAT" >&2
    exit 1
    ;;
esac

printf '✓ Done: %s %s\n' "$FORMAT" "$VERSION"
