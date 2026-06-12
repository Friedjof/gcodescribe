from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ...services.profiles import ProfileImportError, ProfileService

router = APIRouter(tags=["profiles"])


def service() -> ProfileService:
    return ProfileService()


class ProfileRequest(BaseModel):
    name: str | None = None
    calibration: dict | None = None


@router.get("/profiles")
def list_profiles(include_archived: bool = True) -> list[dict]:
    return service().list(include_archived=include_archived)


@router.get("/profiles/active")
def active_profile() -> dict:
    return service().active()


@router.get("/profiles/export-all")
def export_all_profiles() -> JSONResponse:
    return JSONResponse(
        service().export_bundle(),
        headers={"Content-Disposition": 'attachment; filename="plotter-profiles.json"'},
    )


async def _read_json(file: UploadFile) -> dict:
    try:
        return json.loads((await file.read()).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProfileImportError("Datei ist kein gültiges JSON-Dokument.") from exc


@router.post("/profiles/import")
async def import_profile(file: UploadFile = File(...)) -> dict:
    return service().import_profile(await _read_json(file))


@router.post("/profiles/import-all")
async def import_all_profiles(
    file: UploadFile = File(...), replace: bool = Form(False)
) -> dict:
    return service().import_bundle(await _read_json(file), replace=replace)


@router.post("/profiles")
def create_profile(req: ProfileRequest) -> dict:
    return service().create(name=req.name, calibration=req.calibration)


@router.get("/profiles/{profile_id}")
def get_profile(profile_id: str) -> dict:
    return service().get(profile_id)


@router.put("/profiles/{profile_id}")
def update_profile(profile_id: str, req: ProfileRequest) -> dict:
    return service().update(profile_id, name=req.name, calibration=req.calibration)


@router.post("/profiles/{profile_id}/activate")
def activate_profile(profile_id: str) -> dict:
    return service().activate(profile_id)


@router.post("/profiles/{profile_id}/duplicate")
def duplicate_profile(profile_id: str, req: ProfileRequest | None = None) -> dict:
    return service().duplicate(profile_id, name=req.name if req else None)


@router.post("/profiles/{profile_id}/archive")
def archive_profile(profile_id: str) -> dict:
    return service().archive(profile_id)


@router.post("/profiles/{profile_id}/unarchive")
def unarchive_profile(profile_id: str) -> dict:
    return service().unarchive(profile_id)


@router.get("/profiles/{profile_id}/export")
def export_profile(profile_id: str) -> JSONResponse:
    payload = service().export_profile(profile_id)
    name = "".join(
        c if c.isalnum() or c in "-_" else "-" for c in payload["profile"]["name"]
    ) or "profil"
    return JSONResponse(
        payload,
        headers={
            "Content-Disposition": f'attachment; filename="plotter-profil-{name[:40]}.json"'
        },
    )
