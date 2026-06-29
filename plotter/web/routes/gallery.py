from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ...config import load_settings
from ...gcode_preview import parse_gcode, parse_gcode_3d_text
from ...pipeline import PlotterError
from ...services.errors import ServiceError
from ...services.gallery import GalleryService
from ...services.settings_store import load_saved
from ...services.upload_validation import MAX_STL_BYTES, MAX_UPLOAD_BYTES
from ..auth import optional_admin, require_admin

router = APIRouter(tags=["gallery"])

# All gallery routes require an admin session except POST /gallery (create)
# and GET /gallery/upload-info, which stay public. POST /gallery checks the
# upload gate for non-admin requests.


def service() -> GalleryService:
    return GalleryService()


@router.get("/gallery/upload-info")
def gallery_upload_info() -> dict:
    """Public — tells the /upload page whether uploads are currently open."""
    cfg = load_settings(load_saved())
    return {
        "enabled": cfg.gallery.upload_enabled,
        "secret_required": bool(cfg.gallery.upload_secret),
    }


@router.get("/gallery/upload-config")
def gallery_upload_config(_: dict = Depends(require_admin)) -> dict:
    """Admin — returns full upload gate config including the plain-text secret."""
    cfg = load_settings(load_saved())
    return {"enabled": cfg.gallery.upload_enabled, "secret": cfg.gallery.upload_secret}


@router.post("/gallery")
async def create_submission(
    file: UploadFile = File(...),
    title: str = Form(""),
    mode: str = Form("auto"),
    detail: int = Form(2),
    secret: str = Form(""),
    session: dict | None = Depends(optional_admin),
) -> dict:
    if not file.filename:
        raise HTTPException(400, "Dateiname fehlt")

    if not session:
        cfg = load_settings(load_saved())
        if not cfg.gallery.upload_enabled:
            raise HTTPException(403, "Upload ist deaktiviert.")
        if cfg.gallery.upload_secret and secret != cfg.gallery.upload_secret:
            raise HTTPException(403, "Ungültiges Upload-Secret.")

    # Read at most one byte past the limit so oversized uploads never land
    # fully in memory; the service re-checks and reports the proper message.
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    uploader = "admin" if session else "public"
    # mode/detail only apply to the admin asset path; public uploads ignore them.
    return service().create(
        file.filename, data, title=title, uploader=uploader, mode=mode, detail=detail
    )


def _parse_stl_payload(params: str, layers: str) -> tuple[dict, list[dict]]:
    try:
        params_obj = json.loads(params or "{}")
        layers_obj = json.loads(layers or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Ungültige STL-Parameter.") from exc
    if not isinstance(params_obj, dict) or not isinstance(layers_obj, list):
        raise HTTPException(400, "Ungültige STL-Parameter.")
    if not layers_obj:
        raise HTTPException(422, "Keine Linien-Layer übergeben.")
    return params_obj, layers_obj


@router.post("/gallery/stl")
async def create_stl_asset(
    file: UploadFile = File(...),
    params: str = Form("{}"),
    layers: str = Form("[]"),
    title: str = Form(""),
    _: dict = Depends(require_admin),
) -> dict:
    if not file.filename:
        raise HTTPException(400, "Dateiname fehlt")
    params_obj, layers_obj = _parse_stl_payload(params, layers)
    data = await file.read(MAX_STL_BYTES + 1)
    try:
        return service().create_stl(file.filename, data, layers_obj, params_obj, title=title)
    except ServiceError as exc:
        raise HTTPException(getattr(exc, "status_code", 400), str(exc)) from exc
    except PlotterError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/gallery")
def list_submissions(
    include_archived: bool = True,
    uploader: str | None = None,
    _: dict = Depends(require_admin),
) -> list[dict]:
    return service().list(include_archived=include_archived, uploader=uploader)


# Declared before the "/gallery/{item_id}" routes so it is not captured as an id.
@router.get("/gallery/thumbnails")
def submission_thumbnails(_: dict = Depends(require_admin)) -> dict:
    return service().svg_thumbnails()


@router.get("/gallery/{item_id}")
def get_submission(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return service().get(item_id)


@router.get("/gallery/{item_id}/svg")
def submission_svg(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return service().svg_preview(item_id)


@router.get("/gallery/{item_id}/preview/{page}")
def submission_page_preview(item_id: str, page: int, _: dict = Depends(require_admin)) -> dict:
    return service().preview(item_id, page)


@router.get("/gallery/{item_id}/thumbnail")
def submission_thumbnail(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return service().thumbnail(item_id)


@router.get("/gallery/{item_id}/original")
def submission_original(item_id: str, _: dict = Depends(require_admin)) -> FileResponse:
    path, info = service().original_path(item_id)
    return FileResponse(
        path,
        media_type=info.get("mime") or "application/octet-stream",
        filename=info.get("filename") or path.name,
    )


@router.get("/gallery/{item_id}/gcode/preview")
def submission_gcode_preview(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return parse_gcode(service().gcode_path(item_id))


@router.get("/gallery/{item_id}/gcode/preview3d")
def submission_gcode_preview_3d(
    item_id: str,
    page: int = 1,
    _: dict = Depends(require_admin),
) -> dict:
    return parse_gcode_3d_text(service().gcode_preview_text(item_id, page))


# -- admin actions (to be protected once the admin login exists) ---------------


class TitleRequest(BaseModel):
    title: str = ""


class RenderRequest(BaseModel):
    mode: str = "auto"
    detail: int = 2
    continuous: bool = True


@router.patch("/gallery/{item_id}/title")
def set_submission_title(item_id: str, req: TitleRequest, _: dict = Depends(require_admin)) -> dict:
    return service().set_title(item_id, req.title)


@router.post("/gallery/{item_id}/render")
def render_submission(item_id: str, req: RenderRequest, _: dict = Depends(require_admin)) -> dict:
    return service().rerender(
        item_id, mode=req.mode, detail=req.detail, continuous=req.continuous
    )


@router.get("/gallery/{item_id}/stl-params")
def stl_params(item_id: str, _: dict = Depends(require_admin)) -> dict:
    try:
        return service().stl_params(item_id)
    except ServiceError as exc:
        raise HTTPException(getattr(exc, "status_code", 404), str(exc)) from exc


@router.post("/gallery/{item_id}/stl")
def update_stl_asset(
    item_id: str,
    params: str = Form("{}"),
    layers: str = Form("[]"),
    _: dict = Depends(require_admin),
) -> dict:
    params_obj, layers_obj = _parse_stl_payload(params, layers)
    try:
        return service().update_stl(item_id, layers_obj, params_obj)
    except ServiceError as exc:
        raise HTTPException(getattr(exc, "status_code", 400), str(exc)) from exc
    except PlotterError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/gallery/{item_id}/archive")
def archive_submission(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return service().set_status(item_id, "archived")


@router.post("/gallery/{item_id}/unarchive")
def unarchive_submission(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return service().set_status(item_id, "active")


@router.delete("/gallery/{item_id}")
def delete_submission(item_id: str, _: dict = Depends(require_admin)) -> dict:
    service().delete(item_id)
    return {"ok": True}
