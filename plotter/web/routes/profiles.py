from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from plotter.core.calibration import Calibration
from plotter.printer.base import require_profile_switch
from plotter.web.deps import printer_controller, profile_service

from ...services.profiles import ProfileImportError

router = APIRouter(tags=["profiles"])


class ProfileRequest(BaseModel):
    name: str | None = None
    calibration: dict | None = None


@router.get("/profiles")
def list_profiles(include_archived: bool = True) -> list[dict]:
    return profile_service().list(include_archived=include_archived)


@router.get("/profiles/active")
def active_profile() -> dict:
    return profile_service().active()


@router.get("/profiles/export-all")
def export_all_profiles() -> JSONResponse:
    return JSONResponse(
        profile_service().export_bundle(),
        headers={"Content-Disposition": 'attachment; filename="plotter-profiles.json"'},
    )


async def _read_json(file: UploadFile) -> dict:
    try:
        return json.loads((await file.read()).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProfileImportError("Datei ist kein gültiges JSON-Dokument.") from exc


@router.post("/profiles/import")
async def import_profile(file: UploadFile = File(...)) -> dict:
    return profile_service().import_profile(await _read_json(file))


@router.post("/profiles/import-all")
async def import_all_profiles(
    file: UploadFile = File(...), replace: bool = Form(False)
) -> dict:
    return profile_service().import_bundle(await _read_json(file), replace=replace)


@router.post("/profiles")
def create_profile(req: ProfileRequest) -> dict:
    return profile_service().create(name=req.name, calibration=req.calibration)


@router.get("/profiles/{profile_id}")
def get_profile(profile_id: str) -> dict:
    return profile_service().get(profile_id)


@router.get("/profiles/{profile_id}/calibration-state")
def profile_calibration_state(profile_id: str) -> dict:
    """One coherent read for the visual editor, including inactive profiles."""
    profile = profile_service().get(profile_id)
    cal = Calibration.from_dict(profile["calibration"])
    return {
        "profile": profile,
        "paper": {"calibration": profile["calibration"], "rect": cal.paper_rect()},
    }


@router.put("/profiles/{profile_id}")
def update_profile(profile_id: str, req: ProfileRequest) -> dict:
    if req.calibration is not None and profile_service().active_id() == profile_id:
        require_profile_switch((printer_controller().status().get("job") or {}).get("state"))
    return profile_service().update(profile_id, name=req.name, calibration=req.calibration)


@router.post("/profiles/{profile_id}/activate")
def activate_profile(profile_id: str) -> dict:
    require_profile_switch((printer_controller().status().get("job") or {}).get("state"))
    return profile_service().activate(profile_id)


@router.post("/profiles/{profile_id}/duplicate")
def duplicate_profile(profile_id: str, req: ProfileRequest | None = None) -> dict:
    return profile_service().duplicate(profile_id, name=req.name if req else None)


@router.post("/profiles/{profile_id}/archive")
def archive_profile(profile_id: str) -> dict:
    return profile_service().archive(profile_id)


@router.post("/profiles/{profile_id}/unarchive")
def unarchive_profile(profile_id: str) -> dict:
    return profile_service().unarchive(profile_id)


@router.get("/profiles/{profile_id}/export")
def export_profile(profile_id: str) -> JSONResponse:
    payload = profile_service().export_profile(profile_id)
    name = "".join(
        c if c.isalnum() or c in "-_" else "-" for c in payload["profile"]["name"]
    ) or "profil"
    return JSONResponse(
        payload,
        headers={
            "Content-Disposition": f'attachment; filename="plotter-profil-{name[:40]}.json"'
        },
    )
