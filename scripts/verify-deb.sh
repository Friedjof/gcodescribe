#!/usr/bin/env bash
# Run after installing the .deb in a clean build runner/container.
set -euo pipefail
VERSION="${1:?Usage: verify-deb.sh VERSION}"
CHECK_DIR="$(mktemp -d)"
trap 'rm -rf "$CHECK_DIR"' EXIT
cd "$CHECK_DIR"

gcodescribe --help >/dev/null
/usr/lib/gcodescribe/bin/python3 - "$VERSION" <<'PY'
import sys
from importlib.metadata import version
from pathlib import Path

import plotter
from plotter.artwork.svg_raster import _libraries
from plotter.web.app import app

assert version("gcodescribe") == sys.argv[1]
assert (Path(plotter.__file__).parent / "web/static/index.html").is_file()
assert (Path(plotter.__file__).parent / "fonts/Caveat-Static600.ttf").is_file()
_libraries()
assert app is not None
PY

# Exercise the relocated vpype subprocess through the installed CLI.
cat > drawing.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">
  <path d="M2 2 L18 18" fill="none" stroke="black"/>
</svg>
SVG
gcodescribe drawing.svg -o drawing.gcode
test -s drawing.gcode
printf '✓ Installed .deb %s: imports, frontend, fonts, SVG renderer and conversion passed\n' "$VERSION"
