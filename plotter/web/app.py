from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ..pipeline import PlotterError
from ..printer import PrinterError, get_printer_client, use_serial
from ..services import ServiceError
from .auth import require_admin
from .routes import (
    ai_images,
    auth,
    calibration,
    coloring_pages,
    gallery,
    jobs,
    maze,
    osm_map,
    pages,
    paper,
    printer,
    profiles,
    settings,
    sources,
    stream,
    sudoku,
)


@asynccontextmanager
async def _lifespan(_: FastAPI):
    if use_serial():
        # Build the printer manager at process start so an active serial backend
        # owns the USB port for the whole backend lifetime, not only after the
        # first protected UI/API request reaches the printer routes.
        get_printer_client()
    yield
    # Release the serial port on shutdown/reload so the next start can reopen it
    # (a still-held port causes "Resource busy").
    if use_serial():
        from ..printer.serial import shutdown_worker

        shutdown_worker()


def create_app() -> FastAPI:
    app = FastAPI(title="Plotter", version="0.2.0", lifespan=_lifespan)

    app.include_router(auth.router, prefix="/api")
    app.include_router(gallery.router, prefix="/api")
    app.include_router(stream.router, prefix="/api")
    protected_modules = (
        ai_images,
        calibration,
        coloring_pages,
        jobs,
        maze,
        osm_map,
        pages,
        paper,
        printer,
        profiles,
        settings,
        sources,
        sudoku,
    )
    for module in protected_modules:
        app.include_router(module.router, prefix="/api", dependencies=[Depends(require_admin)])

    # Domain errors are raised by the service layer and translated here, so
    # the route handlers stay free of try/except boilerplate.
    @app.exception_handler(PrinterError)
    async def printer_error(_: Request, exc: PrinterError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(ServiceError)
    async def service_error(_: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

    @app.exception_handler(PlotterError)
    async def plotter_error(_: Request, exc: PlotterError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    # Static frontend (built SPA) — mounted last so /api routes take precedence.
    static = Path(__file__).resolve().parent / "static"
    if static.exists():
        # /upload is the public SPA route handed out for event submissions.
        @app.get("/upload", include_in_schema=False)
        def upload_page() -> FileResponse:
            return FileResponse(static / "index.html")

        @app.get("/live", include_in_schema=False)
        def live_page() -> FileResponse:
            return FileResponse(static / "index.html")

        app.mount("/", StaticFiles(directory=str(static), html=True), name="static")

    return app


app = create_app()
