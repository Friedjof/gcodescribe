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
# libglib2.0-0: runtime lib for opencv (area-border tracing).
# Add libreoffice-core for Office support if needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        poppler-utils libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

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

RUN pip install --no-cache-dir uv \
    && uv sync --frozen --no-dev \
    && rm -f /usr/local/bin/uv /usr/local/bin/uvx \
    && rm -rf /usr/local/lib/python3.12/site-packages/uv \
        /usr/local/lib/python3.12/site-packages/uv-*.dist-info \
    && chown -R app:app /app

USER app

VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=4).read()" || exit 1
CMD ["/app/.venv/bin/gcodescribe-web"]
