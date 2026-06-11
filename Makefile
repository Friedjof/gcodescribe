.PHONY: dev build install clean redis redis-stop

-include .env
export

PLOTTER_DATA_DIR ?= data
PLOTTER_PORT     ?= 8000
OCTOPRINT_URL    ?=
OCTOPRINT_API_KEY ?=
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

# Run redis, backend (uvicorn --reload) and frontend (Vite HMR) in parallel.
# Ctrl-C kills both via the trap.
dev: redis
	@printf '\033[1;36m▶ Backend  → http://localhost:$(PLOTTER_PORT)\n'
	@printf '▶ Frontend → http://localhost:5173  (proxy /api → :$(PLOTTER_PORT))\033[0m\n'
	@trap 'kill 0' INT; \
	  PLOTTER_DATA_DIR=$(PLOTTER_DATA_DIR) \
	  PLOTTER_PORT=$(PLOTTER_PORT) \
	  OCTOPRINT_URL=$(OCTOPRINT_URL) \
	  OCTOPRINT_API_KEY=$(OCTOPRINT_API_KEY) \
	  REDIS_URL=$(REDIS_URL) \
	  uv run uvicorn plotter.web.app:app \
	    --host 0.0.0.0 \
	    --port $(PLOTTER_PORT) \
	    --reload \
	    --reload-dir plotter & \
	  cd frontend && npm run dev & \
	  wait

clean:
	rm -rf frontend/node_modules plotter/web/static data
