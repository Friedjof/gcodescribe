from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ..octoprint import OctoPrintError
from ..pipeline import PlotterError
from ..services import ServiceError
from .auth import require_admin
from .routes import (
    auth,
    calibration,
    coloring_pages,
    gallery,
    jobs,
    maze,
    pages,
    paper,
    printer,
    profiles,
    sources,
)


def create_app() -> FastAPI:
    app = FastAPI(title="Plotter", version="0.2.0")

    app.include_router(auth.router, prefix="/api")
    app.include_router(gallery.router, prefix="/api")
    protected_modules = (
        calibration,
        coloring_pages,
        jobs,
        maze,
        pages,
        paper,
        printer,
        profiles,
        sources,
    )
    for module in protected_modules:
        app.include_router(module.router, prefix="/api", dependencies=[Depends(require_admin)])

    # Domain errors are raised by the service layer and translated here, so
    # the route handlers stay free of try/except boilerplate.
    @app.exception_handler(OctoPrintError)
    async def octoprint_error(_: Request, exc: OctoPrintError) -> JSONResponse:
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

        app.mount("/", StaticFiles(directory=str(static), html=True), name="static")

    return app


app = create_app()
