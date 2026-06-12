from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...calibration import Calibration
from ...document import get_document_store
from ...gallery_metrics import evaluate_gcode
from ...gcode_preview import parse_gcode_3d_text
from ...pipeline import PlotterError
from ...scene import save_scene_job, scene_gcode
from ...services.upload_validation import MAX_GCODE_BYTES
from ...text import text_polylines
from .jobs import _job_info

router = APIRouter(tags=["pages"])


def store():
    return get_document_store()


@router.get("/pages")
def list_pages() -> dict:
    """Ordered page metadata + the active page id."""
    return store().list_pages()


@router.get("/pages/{page_id}")
def get_page(page_id: str) -> dict:
    page = store().get_page(page_id)
    if not page:
        raise HTTPException(404, "Seite nicht gefunden")
    return page


class CreateRequest(BaseModel):
    name: str | None = None


@router.post("/pages")
def create_page(req: CreateRequest) -> dict:
    return store().create_page(req.name)


class SaveRequest(BaseModel):
    objects: list | None = None
    grid: dict | None = None
    name: str | None = None


class TextPreviewRequest(BaseModel):
    text: str = "Text"
    font: str = "pdf-serif"
    size: float = 12.0


@router.put("/pages/{page_id}")
def save_page(page_id: str, req: SaveRequest) -> dict:
    try:
        return store().save_page(page_id, req.model_dump(exclude_none=True))
    except KeyError as exc:
        raise HTTPException(404, "Seite nicht gefunden") from exc


@router.delete("/pages/{page_id}")
def delete_page(page_id: str) -> dict:
    return store().delete_page(page_id)


@router.post("/pages/{page_id}/duplicate")
def duplicate_page(page_id: str) -> dict:
    try:
        return store().duplicate_page(page_id)
    except KeyError as exc:
        raise HTTPException(404, "Seite nicht gefunden") from exc


@router.post("/pages/{page_id}/activate")
def activate_page(page_id: str) -> dict:
    return store().set_active(page_id)


@router.post("/pages/{page_id}/gcode")
def page_gcode(page_id: str) -> dict:
    page = store().get_page(page_id)
    if not page:
        raise HTTPException(404, "Seite nicht gefunden")
    path = save_scene_job(page, Calibration.load())
    return _job_info(path).model_dump()


class SceneRequest(BaseModel):
    """Optional live canvas objects, overriding the persisted page state."""

    objects: list | None = None


def _page_for_preview(page_id: str, objects: list | None) -> dict:
    page = store().get_page(page_id)
    if not page:
        raise HTTPException(404, "Seite nicht gefunden")
    return {**page, "objects": objects} if objects is not None else page


@router.post("/pages/{page_id}/score")
def page_score(page_id: str, req: SceneRequest) -> dict:
    """Transient plottability rating of the canvas — no job file is written.

    Uses the same central G-code evaluation as the gallery, so the designer
    score matches what a submission of this drawing would get.
    """
    page = _page_for_preview(page_id, req.objects)
    try:
        gcode = scene_gcode(page, Calibration.load())
    except PlotterError as exc:
        return {"score": None, "metrics": None, "reason": str(exc)}
    return {**evaluate_gcode(gcode, MAX_GCODE_BYTES), "reason": None}


@router.post("/pages/{page_id}/preview3d")
def page_preview_3d(page_id: str, req: SceneRequest) -> dict:
    """3D tool-path preview of the current canvas without saving a job."""
    page = _page_for_preview(page_id, req.objects)
    try:
        gcode = scene_gcode(page, Calibration.load())
    except PlotterError as exc:
        raise HTTPException(400, str(exc)) from exc
    return parse_gcode_3d_text(gcode)


@router.post("/paint/text-polylines")
def paint_text_polylines(req: TextPreviewRequest) -> dict:
    return {"polylines": text_polylines(req.text, font=req.font, size=req.size)}
