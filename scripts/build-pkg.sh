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

rm -rf staging AppDir appimagetool-x86_64.AppImage \
  "GCodeScribe-${VERSION}-x86_64.AppImage"

STAGING="$(pwd)/staging"
VENV="$STAGING/usr/lib/gcodescribe"

printf '▶ Installing into staging venv…\n'
python3.12 -m venv "$VENV"
"$VENV/bin/pip" install --quiet .

# Launcher wrappers invoke the venv's python *binary* directly rather than the
# generated console scripts: a venv is not relocatable, so those scripts bake
# the build-time path into their shebang (#!/src/staging/...) and break once the
# tree is installed elsewhere. The python binary is a symlink with no baked path,
# and venv site-packages are resolved relative to the interpreter at runtime.
mkdir -p "$STAGING/usr/bin"
emit_wrapper() {  # $1 = command name, $2 = module providing main()
  cat > "$STAGING/usr/bin/$1" <<EOF
#!/bin/sh
exec /usr/lib/gcodescribe/bin/python3 -c "from $2 import main; main()" "\$@"
EOF
  chmod +x "$STAGING/usr/bin/$1"
}
emit_wrapper gcodescribe         plotter.cli
emit_wrapper gcodescribe-web     plotter.web.server
emit_wrapper gcodescribe-desktop plotter.desktop.app

install -Dm644 packaging/flatpak/info.noweck.gcodescribe.desktop \
  "$STAGING/usr/share/applications/info.noweck.gcodescribe.desktop"
install -Dm644 packaging/flatpak/info.noweck.gcodescribe.svg \
  "$STAGING/usr/share/icons/hicolor/scalable/apps/info.noweck.gcodescribe.svg"
install -Dm644 packaging/flatpak/info.noweck.gcodescribe.metainfo.xml \
  "$STAGING/usr/share/metainfo/info.noweck.gcodescribe.metainfo.xml"

FPM_COMMON=(
  -f                # overwrite an existing output package instead of aborting
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
    # Resolve our own location: $APPDIR is set by the AppImage runtime, but fall
    # back to the script dir so `./AppDir/AppRun` also works when run unpacked.
    cat > AppDir/AppRun <<'EOF'
#!/bin/sh
HERE="${APPDIR:-$(dirname "$(readlink -f "$0")")}"
exec "$HERE/usr/lib/gcodescribe/bin/python3" \
  -c "from plotter.desktop.app import main; main()" "$@"
EOF
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
