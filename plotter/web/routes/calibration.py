from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from plotter.artwork.export import CalibrationImportError, calibration_from_xml, calibration_to_xml
from plotter.core.calibration import Calibration, PositionKind
from plotter.web.deps import printer_controller, profile_service
from plotter.web.project_context import active_project_profile

router = APIRouter(tags=["calibration"])


def _calibration_context(project_id: str | None) -> tuple[Calibration, str | None]:
    if project_id is None:
        return Calibration.load(), None
    profile = active_project_profile(project_id)
    return Calibration.from_dict(profile["calibration"]), profile["id"]


def _save_calibration(cal: Calibration, profile_id: str | None) -> None:
    if profile_id is None:
        cal.save()
    else:
        profile_service().save_calibration(profile_id, cal)


@router.get("/calibration/export")
def export_calibration(project_id: str | None = None) -> Response:
    """Download the full calibration as XML."""
    return Response(
        calibration_to_xml(_calibration_context(project_id)[0]),
        media_type="application/xml",
        headers={"Content-Disposition": 'attachment; filename="plotter-calibration.xml"'},
    )


@router.post("/calibration/import")
async def import_calibration(
    file: UploadFile = File(...), project_id: str | None = None
) -> dict:
    """Replace the calibration from an uploaded XML file.

    Missing fields fall back to the current calibration, so a partial export
    still imports cleanly.
    """
    try:
        text = (await file.read()).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CalibrationImportError("Datei ist kein UTF-8-Text.") from exc
    base, profile_id = _calibration_context(project_id)
    cal = calibration_from_xml(text, base=base)
    _save_calibration(cal, profile_id)
    return cal.as_dict()


@router.get("/calibration")
def get_calibration(project_id: str | None = None) -> dict:
    return _calibration_context(project_id)[0].as_dict()


@router.put("/calibration")
def put_calibration(updates: dict, project_id: str | None = None) -> dict:
    base, profile_id = _calibration_context(project_id)
    try:
        cal = base.merged(updates)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    _save_calibration(cal, profile_id)
    return cal.as_dict()


class PenHeightRequest(BaseModel):
    which: str  # up | down
    projectId: str | None = None


class PositionCaptureRequest(BaseModel):
    kind: PositionKind
    projectId: str | None = None


@router.post("/calibration/position-from-head")
def position_from_head(req: PositionCaptureRequest) -> dict:
    cal, profile_id = _calibration_context(req.projectId)
    return printer_controller().position_from_head(
        req.kind, cal=cal, profile_id=profile_id
    ).as_dict()


@router.post("/calibration/pen-from-position")
def pen_from_position(req: PenHeightRequest) -> dict:
    """Store the current head Z as the pen-up or pen-down height."""
    cal, profile_id = _calibration_context(req.projectId)
    return printer_controller().pen_height_from_position(
        req.which, cal=cal, profile_id=profile_id
    ).as_dict()
