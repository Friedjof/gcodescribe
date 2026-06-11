# --- Stage 1: build the React frontend -----------------------------------
FROM node:22-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
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
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        poppler-utils libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# uv for fast, reproducible installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY plotter/ ./plotter/
COPY main.py ./
# Built SPA from stage 1.
COPY --from=frontend /build/plotter/web/static ./plotter/web/static

RUN uv sync --frozen --no-dev

VOLUME ["/data"]
EXPOSE 8000
CMD ["uv", "run", "--no-dev", "gcodescribe-web"]
