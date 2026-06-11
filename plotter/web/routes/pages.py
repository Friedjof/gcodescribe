from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...calibration import Calibration
from ...document import get_document_store
from ...scene import save_scene_job
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
        raise HTTPException(404, "page not found")
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
        raise HTTPException(404, "page not found") from exc


@router.delete("/pages/{page_id}")
def delete_page(page_id: str) -> dict:
    return store().delete_page(page_id)


@router.post("/pages/{page_id}/duplicate")
def duplicate_page(page_id: str) -> dict:
    try:
        return store().duplicate_page(page_id)
    except KeyError as exc:
        raise HTTPException(404, "page not found") from exc


@router.post("/pages/{page_id}/activate")
def activate_page(page_id: str) -> dict:
    return store().set_active(page_id)


@router.post("/pages/{page_id}/gcode")
def page_gcode(page_id: str) -> dict:
    page = store().get_page(page_id)
    if not page:
        raise HTTPException(404, "page not found")
    path = save_scene_job(page, Calibration.load())
    return _job_info(path).model_dump()


@router.post("/paint/text-polylines")
def paint_text_polylines(req: TextPreviewRequest) -> dict:
    return {"polylines": text_polylines(req.text, font=req.font, size=req.size)}
