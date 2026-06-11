from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ..octoprint import OctoPrintError
from ..pipeline import PlotterError
from ..services import ServiceError
from .routes import calibration, jobs, pages, paper, printer, sources


def create_app() -> FastAPI:
    app = FastAPI(title="Plotter", version="0.2.0")

    for module in (calibration, jobs, pages, paper, printer, sources):
        app.include_router(module.router, prefix="/api")

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
        app.mount("/", StaticFiles(directory=str(static), html=True), name="static")

    return app


app = create_app()
