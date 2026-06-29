from __future__ import annotations

import json
import re

from fastapi import APIRouter, Body, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ...services import ServiceError
from ...services.stroke_fonts import StrokeFontService

router = APIRouter(tags=["stroke-fonts"])

# A backup is plain JSON; cap the upload so a hostile/huge file can't exhaust
# memory before the model's per-document limits even run.
MAX_IMPORT_BYTES = 25 * 1024 * 1024
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def service() -> StrokeFontService:
    return StrokeFontService()


def _error(message: str, status_code: int) -> ServiceError:
    err = ServiceError(message)
    err.status_code = status_code
    return err


def _safe_filename(label: str) -> str:
    return _SAFE_NAME_RE.sub("-", label).strip("-.") or "font"


class StrokeFontCreateRequest(BaseModel):
    label: str


@router.get("/stroke-fonts")
def list_stroke_fonts() -> dict:
    return {"strokeFonts": service().list()}


@router.post("/stroke-fonts")
def create_stroke_font(req: StrokeFontCreateRequest) -> dict:
    return {"strokeFont": service().create(req.label)}


@router.get("/stroke-fonts/{font_id}")
def get_stroke_font(font_id: str) -> dict:
    return {"strokeFont": service().get(font_id)}


@router.put("/stroke-fonts/{font_id}")
def save_stroke_font(font_id: str, document: dict = Body(...)) -> dict:
    return {"strokeFont": service().save(font_id, document)}


@router.delete("/stroke-fonts/{font_id}")
def delete_stroke_font(font_id: str) -> dict:
    service().delete(font_id)
    return {"strokeFonts": service().list()}


@router.get("/stroke-fonts/{font_id}/export")
def export_stroke_font(font_id: str) -> JSONResponse:
    data = service().export(font_id)
    name = _safe_filename(str(data["font"].get("label") or "font"))
    return JSONResponse(
        data,
        headers={"Content-Disposition": f'attachment; filename="{name}.gcsfont"'},
    )


@router.post("/stroke-fonts/import")
async def import_stroke_font(file: UploadFile = File(...)) -> dict:
    payload = await file.read()
    if len(payload) > MAX_IMPORT_BYTES:
        raise _error("Die Datei ist zu groß", 413)
    try:
        raw = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise _error("Datei ist kein gültiges .gcsfont-JSON", 422) from exc
    document = service().import_font(raw)
    return {"strokeFont": document, "strokeFonts": service().list()}
