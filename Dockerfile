# --- Stage 1: build the React frontend -----------------------------------
FROM node:22-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# vite outputs to ../plotter/web/static (see vite.config.ts)
RUN npm run build

# --- Stage 2: python runtime ---------------------------------------------
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PLOTTER_DATA_DIR=/data \
    PLOTTER_HOST=0.0.0.0 \
    PLOTTER_PORT=8000

# poppler-utils: pdftocairo (PDF->SVG vector), pdftoppm/pdfinfo (raster trace).
# libgl1 + libglib2.0-0: runtime libs for opencv (area-border tracing).
# Add libreoffice-core for Office support if needed.
# curl: used by the container HEALTHCHECK below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        poppler-utils libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

# uv for fast, reproducible installs. Install from PyPI instead of copying from
# GHCR so local builds don't depend on GitHub Container Registry auth/token fetches.
RUN pip install --no-cache-dir uv

# Run as an unprivileged user. The data volume is created and chowned here so
# the non-root process can write to it (named volumes inherit this ownership).
RUN useradd --create-home --uid 10001 app \
    && mkdir -p /data \
    && chown app:app /data

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY plotter/ ./plotter/
COPY main.py ./
# Built SPA from stage 1.
COPY --from=frontend /build/plotter/web/static ./plotter/web/static

RUN uv sync --frozen --no-dev \
    && chown -R app:app /app

USER app

VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1
CMD ["uv", "run", "--no-dev", "gcodescribe-web"]
