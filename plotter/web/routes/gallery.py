from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ...gcode_preview import parse_gcode, parse_gcode_3d
from ...services.gallery import GalleryService
from ...services.upload_validation import MAX_UPLOAD_BYTES
from ..auth import require_admin

router = APIRouter(tags=["gallery"])

# NOTE: The gallery has no auth yet. Admin-only actions (delete, archive,
# status) are grouped below so a permission dependency can be added in one
# place once the admin login lands.


def service() -> GalleryService:
    return GalleryService()


@router.post("/gallery")
async def create_submission(
    file: UploadFile = File(...),
    title: str = Form(""),
) -> dict:
    if not file.filename:
        raise HTTPException(400, "Dateiname fehlt")
    # Read at most one byte past the limit so oversized uploads never land
    # fully in memory; the service re-checks and reports the proper message.
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    return service().create(file.filename, data, title=title)


@router.get("/gallery")
def list_submissions(
    include_archived: bool = True,
    _: dict = Depends(require_admin),
) -> list[dict]:
    return service().list(include_archived=include_archived)


@router.get("/gallery/{item_id}")
def get_submission(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return service().get(item_id)


@router.get("/gallery/{item_id}/svg")
def submission_svg(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return service().svg_preview(item_id)


@router.get("/gallery/{item_id}/gcode/preview")
def submission_gcode_preview(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return parse_gcode(service().gcode_path(item_id))


@router.get("/gallery/{item_id}/gcode/preview3d")
def submission_gcode_preview_3d(item_id: str, _: dict = Depends(require_admin)) -> dict:
    return parse_gcode_3d(service().gcode_path(item_id))


# -- admin actions (to be protected once the admin login exists) ---------------


class TitleRequest(BaseModel):
    title: str = ""


@router.patch("/gallery/{item_id}/title")
def set_submission_title(item_id: str, req: TitleRequest, _: dict = Depends(require_admin)) -> dict:
    return service().set_title(item_id, req.title)


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
