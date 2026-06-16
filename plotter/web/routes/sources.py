from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ...services.profiles import ProfileService
from ...services.sources import SourceService
from .jobs import _job_info

# LEGACY: the Sources store is superseded by the unified gallery (merge plan
# stage 5d). The designer image import and gallery popup now go through
# /api/gallery; only the Place tab still calls these endpoints and they are
# removed together with Place in stage 7/8. No new callers should be added.
router = APIRouter(tags=["sources"])


def service() -> SourceService:
    return SourceService()


@router.post("/sources")
def create_source(
    file: UploadFile = File(...),
    mode: str = Form("auto"),
    detail: int = Form(1),
) -> dict:
    # Sync endpoint: the conversion (tracing, SVG render) is CPU-heavy, so
    # FastAPI runs it in a threadpool and the event loop stays responsive for
    # other requests instead of freezing for the whole upload.
    if not file.filename:
        raise HTTPException(400, "Dateiname fehlt")
    data = file.file.read()
    return service().create(file.filename, data, mode=mode, detail=max(1, min(detail, 3)))


@router.get("/sources")
def list_sources() -> list[dict]:
    return service().list()


@router.delete("/sources/{source_id}")
def delete_source(source_id: str) -> dict:
    service().delete(source_id)
    return {"ok": True}


@router.get("/sources/thumbnails")
def source_thumbnails() -> dict:
    return service().thumbnails()


@router.get("/sources/{source_id}/preview/{page}")
def source_preview(source_id: str, page: int, max_points: int = 20000) -> dict:
    return service().preview(source_id, page, max_points=max(100, min(max_points, 40000)))


@router.get("/sources/{source_id}/thumbnail")
def source_thumbnail(source_id: str) -> dict:
    return service().thumbnail(source_id)


class PlacementRequest(BaseModel):
    page: int = 1
    x: float  # printer mm, lower-left corner of the drawing
    y: float
    width: float  # target width in mm (aspect ratio is preserved)


@router.post("/sources/{source_id}/gcode")
def source_gcode(source_id: str, req: PlacementRequest) -> dict:
    path = service().generate_gcode(
        source_id, req.page, x=req.x, y=req.y, width=req.width
    )
    return _job_info(path, active_profile=ProfileService().active_profile_meta()).model_dump()


@router.post("/sources/{source_id}/score")
def source_score(source_id: str, req: PlacementRequest) -> dict:
    """Live plottability rating of a placement (no job file written)."""
    try:
        result = service().score_placement(
            source_id, req.page, x=req.x, y=req.y, width=req.width
        )
    except Exception as exc:  # noqa: BLE001 — surface the reason to the UI
        return {"score": None, "metrics": None, "reason": str(exc)}
    return {**result, "reason": None}
