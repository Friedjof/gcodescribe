from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ...services.sources import SourceService
from .jobs import _job_info

router = APIRouter(tags=["sources"])


def service() -> SourceService:
    return SourceService()


@router.post("/sources")
async def create_source(
    file: UploadFile = File(...),
    mode: str = Form("auto"),
    detail: int = Form(1),
) -> dict:
    if not file.filename:
        raise HTTPException(400, "Dateiname fehlt")
    data = await file.read()
    return service().create(file.filename, data, mode=mode, detail=max(1, min(detail, 3)))


@router.get("/sources")
def list_sources() -> list[dict]:
    return service().list()


@router.delete("/sources/{source_id}")
def delete_source(source_id: str) -> dict:
    service().delete(source_id)
    return {"ok": True}


@router.get("/sources/{source_id}/preview/{page}")
def source_preview(source_id: str, page: int) -> dict:
    return service().preview(source_id, page)


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
    return _job_info(path).model_dump()
