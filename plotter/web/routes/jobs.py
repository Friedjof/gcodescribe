from __future__ import annotations

import shutil
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from plotter.artwork.convert import convert_with_calibration
from plotter.core.calibration import Calibration
from plotter.core.jobmeta import (
    delete_job_meta,
    job_profile_status,
    profile_comment,
    read_job_meta_checked,
    rename_job_meta,
    write_job_meta,
)
from plotter.core.storage import jobs_dir
from plotter.gcode.pressure import job_uses_pressure
from plotter.gcode.preview import parse_gcode, parse_gcode_3d
from plotter.gcode.profile import TEST_PATTERNS, test_pattern
from plotter.gcode.safety import GcodeSafetyChecker, SafetyViolation
from plotter.web.deps import profile_service
from plotter.web.project_context import calibration_profile

from ...services.profiles import profile_meta

router = APIRouter(tags=["jobs"])


class JobProfileStatus(BaseModel):
    id: str | None = None
    name: str | None = None
    fingerprint: str | None = None
    matchesActive: bool = False
    stale: bool = False
    legacy: bool = False
    missing: bool = False
    archived: bool = False


class JobInfo(BaseModel):
    filename: str
    size: int
    created: float
    # Whether the job still fits the current calibration (plot area / pen
    # heights). None when not checked (single-file responses).
    fits: bool | None = None
    issue: str | None = None
    # Profile the job was generated with, evaluated against the active
    # profile at list time. None when not checked.
    profile: JobProfileStatus | None = None
    # Sidecar source block (e.g. coloring jobs carry colour + color_group_id),
    # so the job list can badge and group them. None when not checked.
    source: dict | None = None


def _job_info(
    path: Path,
    cal: Calibration | None = None,
    active_profile: dict | None = None,
    profiles: dict[str, dict] | None = None,
) -> JobInfo:
    stat = path.stat()
    info = JobInfo(filename=path.name, size=stat.st_size, created=stat.st_mtime)
    effective_cal = cal
    meta = None
    if active_profile is not None:
        meta, meta_issue = read_job_meta_checked(path)
        info.source = (meta or {}).get("source")
        if meta_issue:
            info.fits = False
            info.issue = meta_issue
        source = info.source or {}
        if source.get("project_id") and source.get("kind") in (
            "paint_page",
            "paint_coloring",
            "testpattern",
        ):
            from .printer import ProjectJobError, _project_job_calibration

            ref = (meta or {}).get("profile") or {}
            try:
                effective_cal = _project_job_calibration(meta)
                info.profile = JobProfileStatus(
                    id=ref.get("id"),
                    name=ref.get("name"),
                    fingerprint=ref.get("fingerprint"),
                    matchesActive=True,
                )
            except ProjectJobError as exc:
                info.profile = JobProfileStatus(
                    id=ref.get("id"),
                    name=ref.get("name"),
                    fingerprint=ref.get("fingerprint"),
                    matchesActive=False,
                )
                info.fits = False
                info.issue = str(exc)
        else:
            info.profile = JobProfileStatus(**job_profile_status(meta, active_profile, profiles))
    if effective_cal is not None and info.fits is not False:
        try:
            if meta is None:
                meta, _ = read_job_meta_checked(path)
            GcodeSafetyChecker(effective_cal, allow_pressure=job_uses_pressure(meta)).check(
                path.read_text(),
                name=path.name,
            )
            info.fits = True
        except SafetyViolation as exc:
            info.fits = False
            info.issue = str(exc)
    return info


def _job_path(filename: str) -> Path:
    path = jobs_dir() / Path(filename).name
    if not path.exists():
        raise HTTPException(404, "Job nicht gefunden")
    return path


def _active() -> tuple[Calibration, dict]:
    """Active profile's calibration + compact metadata, from one read."""
    profile = profile_service().active()
    return Calibration.from_dict(profile["calibration"]), profile_meta(profile)


def _profiles_by_id() -> dict[str, dict]:
    return {p["id"]: p for p in profile_service().list(include_archived=True)}


@router.get("/jobs")
def list_jobs() -> list[JobInfo]:
    # Validate each job against the current calibration so the UI can flag
    # jobs that no longer fit the (possibly resized) plot area, and against
    # the active profile so foreign/stale/legacy jobs are marked.
    cal, active = _active()
    profiles = _profiles_by_id()
    return sorted(
        (_job_info(p, cal, active, profiles) for p in jobs_dir().glob("*.gcode")),
        key=lambda j: j.created,
        reverse=True,
    )


@router.post("/convert")
async def convert(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(400, "Dateiname fehlt")
    cal, active = _active()
    # Keep the original filename (sanitised) so generated G-code is named after it.
    safe_name = Path(file.filename).name
    with tempfile.TemporaryDirectory(prefix="plotter-upload-") as tmp:
        source = Path(tmp) / safe_name
        with source.open("wb") as fh:
            shutil.copyfileobj(file.file, fh)
        result = convert_with_calibration(source, jobs_dir(), cal)
    for path in result.gcode_files:
        write_job_meta(
            path,
            source={"kind": "convert", "filename": safe_name},
            profile=active,
        )
    return {
        "files": [
            _job_info(p, active_profile=active, profiles={active["id"]: active}).model_dump()
            for p in result.gcode_files
        ]
    }


@router.get("/jobs/{filename}")
def download_job(filename: str) -> FileResponse:
    path = _job_path(filename)
    return FileResponse(path, media_type="text/plain", filename=path.name)


@router.delete("/jobs/{filename}")
def delete_job(filename: str) -> dict:
    path = jobs_dir() / Path(filename).name
    path.unlink(missing_ok=True)
    delete_job_meta(path)
    return {"ok": True}


class RenameRequest(BaseModel):
    name: str  # new base name (with or without .gcode)


@router.post("/jobs/{filename}/rename")
def rename_job(filename: str, req: RenameRequest) -> JobInfo:
    src = _job_path(filename)
    # Sanitise: strip any path, force a single .gcode extension.
    stem = Path(req.name.strip()).name
    if stem.lower().endswith(".gcode"):
        stem = stem[: -len(".gcode")]
    if not stem:
        raise HTTPException(422, "Name darf nicht leer sein.")
    dst = jobs_dir() / f"{stem}.gcode"
    if dst != src and dst.exists():
        raise HTTPException(409, "Eine Datei mit diesem Namen existiert bereits.")
    if dst != src and dst.with_suffix(".json").exists():
        raise HTTPException(409, "Eine Job-Metadatendatei mit diesem Namen existiert bereits.")
    if dst != src:
        src.rename(dst)
        try:
            rename_job_meta(src, dst)
        except Exception:
            # Keep job and sidecar from diverging if metadata movement fails.
            dst.rename(src)
            raise
    cal, active = _active()
    return _job_info(dst, cal, active, _profiles_by_id())


@router.get("/jobs/{filename}/preview")
def job_preview(filename: str) -> dict:
    return parse_gcode(_job_path(filename))


@router.get("/jobs/{filename}/preview3d")
def job_preview_3d(filename: str) -> dict:
    path = _job_path(filename)
    meta, _ = read_job_meta_checked(path)
    snapshot = (meta or {}).get("calibrationSnapshot") or {}
    saved_cal = snapshot.get("calibration") if isinstance(snapshot, dict) else None
    if not isinstance(saved_cal, dict):
        profile_id = ((meta or {}).get("profile") or {}).get("id")
        profile = _profiles_by_id().get(profile_id) if isinstance(profile_id, str) else None
        saved_cal = profile.get("calibration") if profile else None
    cal = Calibration.from_dict(saved_cal) if isinstance(saved_cal, dict) else _active()[0]
    return {**parse_gcode_3d(path), "bed": [cal.bed_width, cal.bed_height]}


@router.post("/testpattern/{name}")
def make_test_pattern(
    name: str, project_id: str | None = None, profile_id: str | None = None
) -> dict:
    if name not in TEST_PATTERNS:
        raise HTTPException(404, f"Unbekanntes Test-Pattern: {name}")
    snapshot = None
    if project_id is None and profile_id is None:
        cal, active = _active()
    else:
        profile = calibration_profile(project_id, profile_id)
        cal = Calibration.from_dict(profile["calibration"])
        active = profile_meta(profile)
        snapshot = {
            "profileId": profile["id"],
            "profileName": profile["name"],
            "fingerprint": profile["fingerprint"],
            "calibration": profile["calibration"],
            "capturedAt": time.time(),
        }
    gcode = test_pattern(name, cal)
    out = jobs_dir() / f"test-{name}-{int(time.time())}-{uuid.uuid4().hex[:8]}.gcode"
    out.write_text(profile_comment(active) + gcode)
    source = {"kind": "testpattern", "name": name}
    if project_id is not None:
        source["project_id"] = project_id
    write_job_meta(out, source=source, profile=active, calibration_snapshot=snapshot)
    return _job_info(out, active_profile=active, profiles={active["id"]: active}).model_dump()
