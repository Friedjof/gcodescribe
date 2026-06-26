.PHONY: dev dev-plain build setup install bundle flatpak clean redis redis-stop \
        pkg-image deb rpm appimage packages

-include .env
export

VERSION := $(shell grep '^version' pyproject.toml | sed 's/version = "\(.*\)"/\1/')
PKG_IMAGE := gcodescribe-packager

PLOTTER_DATA_DIR ?= data
PLOTTER_PORT     ?= 8010
OCTOPRINT_URL    ?=
OCTOPRINT_API_KEY ?=
PRINTER_SERIAL_ENABLED ?= false
PRINTER_DEFAULT_BACKEND ?=
PRINTER_SERIAL_PORT ?= /dev/ttyUSB0
PRINTER_SERIAL_BAUD ?= 115200
REDIS_PORT       ?= 6379
REDIS_URL        ?= redis://localhost:$(REDIS_PORT)/0

setup:
	uv sync
	cd frontend && npm install

build:
	cd frontend && npm run build

# Schnell: baut inkrementell aus Cache, installiert direkt — kein Bundle-Schritt.
install:
	@bash scripts/flatpak-install.sh

# Langsam: erstellt GCodeScribe.flatpak für Distribution (~2–5 min xz-Kompression).
bundle:
	@bash scripts/flatpak-bundle.sh

# Alias für Rückwärtskompatibilität
flatpak: bundle

# Persistent Redis for the position cache (survives app restarts).
redis:
	@docker start gcodescribe-redis >/dev/null 2>&1 || \
	  docker run -d --name gcodescribe-redis \
	    -p $(REDIS_PORT):6379 \
	    -v gcodescribe-redis-data:/data \
	    redis:7-alpine redis-server --appendonly yes >/dev/null 2>&1 || \
	  printf '\033[1;33m⚠ Docker/Redis nicht verfügbar — Backend nutzt den Datei-Store\033[0m\n'
	@printf '\033[1;36m▶ Redis    → redis://localhost:$(REDIS_PORT)/0\033[0m\n'

redis-stop:
	docker rm -f gcodescribe-redis

# Interactive dev launcher: choose services, serial options and preflight checks.
dev:
	@bash scripts/dev-menu.sh

# Direct dev launcher for scripts/automation. Starts backend + frontend with the
# current environment; no menu, no Redis bootstrap.
dev-plain:
	@bash scripts/dev.sh

# ── Package targets (Docker-based, reproducible) ─────────────────────────────

# Build the packaging container once; subsequent calls hit the layer cache.
pkg-image:
	docker build -t $(PKG_IMAGE) -f packaging/Dockerfile.pkg .

# Build a .deb inside the container and drop it in the project root.
deb: pkg-image
	docker run --rm -v "$(CURDIR):/src" -w /src $(PKG_IMAGE) \
		bash scripts/build-pkg.sh deb $(VERSION)

# Build a .rpm inside the container and drop it in the project root.
rpm: pkg-image
	docker run --rm -v "$(CURDIR):/src" -w /src $(PKG_IMAGE) \
		bash scripts/build-pkg.sh rpm $(VERSION)

# Build an AppImage inside the container and drop it in the project root.
appimage: pkg-image
	docker run --rm -v "$(CURDIR):/src" -w /src $(PKG_IMAGE) \
		bash scripts/build-pkg.sh appimage $(VERSION)

# Build all three formats in sequence.
packages: deb rpm appimage

clean:
	rm -rf frontend/node_modules plotter/web/static data staging AppDir \
		appimagetool-x86_64.AppImage *.deb *.rpm GCodeScribe-*.AppImage
