from __future__ import annotations

import shutil
import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ...calibration import Calibration
from ...convert import convert_with_calibration
from ...gcode_preview import parse_gcode, parse_gcode_3d
from ...gcode_profile import TEST_PATTERNS, test_pattern
from ...jobmeta import (
    delete_job_meta,
    job_profile_status,
    profile_comment,
    read_job_meta_checked,
    rename_job_meta,
    write_job_meta,
)
from ...safety import GcodeSafetyChecker, SafetyViolation
from ...services.profiles import ProfileService, profile_meta
from ...storage import jobs_dir

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
    if cal is not None:
        try:
            GcodeSafetyChecker(cal).check(path.read_text(), name=path.name)
            info.fits = True
        except SafetyViolation as exc:
            info.fits = False
            info.issue = str(exc)
    if active_profile is not None:
        meta, meta_issue = read_job_meta_checked(path)
        info.profile = JobProfileStatus(
            **job_profile_status(meta, active_profile, profiles)
        )
        info.source = (meta or {}).get("source")
        if meta_issue:
            info.fits = False
            info.issue = meta_issue
    return info


def _job_path(filename: str) -> Path:
    path = jobs_dir() / Path(filename).name
    if not path.exists():
        raise HTTPException(404, "Job nicht gefunden")
    return path


def _active() -> tuple[Calibration, dict]:
    """Active profile's calibration + compact metadata, from one read."""
    profile = ProfileService().active()
    return Calibration().merged(profile["calibration"]), profile_meta(profile)


def _profiles_by_id() -> dict[str, dict]:
    return {p["id"]: p for p in ProfileService().list(include_archived=True)}


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
    return parse_gcode_3d(_job_path(filename))


@router.post("/testpattern/{name}")
def make_test_pattern(name: str) -> dict:
    if name not in TEST_PATTERNS:
        raise HTTPException(404, f"Unbekanntes Test-Pattern: {name}")
    cal, active = _active()
    gcode = test_pattern(name, cal)
    out = jobs_dir() / f"test-{name}-{int(time.time())}.gcode"
    out.write_text(profile_comment(active) + gcode)
    write_job_meta(out, source={"kind": "testpattern", "name": name}, profile=active)
    return _job_info(out, active_profile=active, profiles={active["id"]: active}).model_dump()
