.PHONY: dev dev-plain build install clean redis redis-stop

-include .env
export

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

install:
	uv sync
	cd frontend && npm install

build:
	cd frontend && npm run build

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

clean:
	rm -rf frontend/node_modules plotter/web/static data
