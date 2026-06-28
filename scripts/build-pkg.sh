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
# These packages ship the CLI and the web server only. The GTK desktop GUI
# (gcodescribe-desktop) needs PyGObject/GTK from the host, which a relocatable
# venv cannot reliably provide across distros — the desktop GUI is delivered
# via Flatpak instead, which bundles the full GNOME runtime.
mkdir -p "$STAGING/usr/bin"
emit_wrapper() {  # $1 = command name, $2 = module providing main()
  cat > "$STAGING/usr/bin/$1" <<EOF
#!/bin/sh
exec /usr/lib/gcodescribe/bin/python3 -c "from $2 import main; main()" "\$@"
EOF
  chmod +x "$STAGING/usr/bin/$1"
}
emit_wrapper gcodescribe     plotter.cli
emit_wrapper gcodescribe-web plotter.web.server

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
      --depends python3.12 \
      --depends poppler-utils \
      --depends libglib2.0-0 \
      "${FPM_COMMON[@]}"
    ;;
  rpm)
    printf '▶ Building .rpm…\n'
    fpm -s dir -t rpm \
      --depends python3.12 \
      --depends poppler-utils \
      --depends glib2 \
      "${FPM_COMMON[@]}"
    ;;
  appimage)
    printf '▶ Building AppImage…\n'
    wget -q \
      https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
    chmod +x appimagetool-x86_64.AppImage

    cp -a staging/. AppDir/
    # appimagetool requires a .desktop + matching icon. This AppImage launches
    # the web server (the GTK GUI lives in the Flatpak); Exec reflects that.
    cp packaging/flatpak/info.noweck.gcodescribe.svg AppDir/info.noweck.gcodescribe.svg
    cat > AppDir/gcodescribe.desktop <<'EOF'
[Desktop Entry]
Name=GCodeScribe
Comment=Convert documents into pen-plotter G-code (web server)
Exec=gcodescribe-web
Icon=info.noweck.gcodescribe
Terminal=true
Type=Application
Categories=Graphics;Engineering;
EOF
    # Resolve our own location: $APPDIR is set by the AppImage runtime, but fall
    # back to the script dir so `./AppDir/AppRun` also works when run unpacked.
    cat > AppDir/AppRun <<'EOF'
#!/bin/sh
HERE="${APPDIR:-$(dirname "$(readlink -f "$0")")}"
exec "$HERE/usr/lib/gcodescribe/bin/python3" \
  -c "from plotter.web.server import main; main()" "$@"
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
