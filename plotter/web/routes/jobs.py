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
from ...safety import GcodeSafetyChecker, SafetyViolation
from ...storage import jobs_dir

router = APIRouter(tags=["jobs"])


class JobInfo(BaseModel):
    filename: str
    size: int
    created: float
    # Whether the job still fits the current calibration (plot area / pen
    # heights). None when not checked (single-file responses).
    fits: bool | None = None
    issue: str | None = None


def _job_info(path: Path, cal: Calibration | None = None) -> JobInfo:
    stat = path.stat()
    info = JobInfo(filename=path.name, size=stat.st_size, created=stat.st_mtime)
    if cal is not None:
        try:
            GcodeSafetyChecker(cal).check(path.read_text(), name=path.name)
            info.fits = True
        except SafetyViolation as exc:
            info.fits = False
            info.issue = str(exc)
    return info


def _job_path(filename: str) -> Path:
    path = jobs_dir() / Path(filename).name
    if not path.exists():
        raise HTTPException(404, "job not found")
    return path


@router.get("/jobs")
def list_jobs() -> list[JobInfo]:
    # Validate each job against the current calibration so the UI can flag
    # jobs that no longer fit the (possibly resized) plot area.
    cal = Calibration.load()
    return sorted(
        (_job_info(p, cal) for p in jobs_dir().glob("*.gcode")),
        key=lambda j: j.created,
        reverse=True,
    )


@router.post("/convert")
async def convert(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(400, "missing filename")
    cal = Calibration.load()
    # Keep the original filename (sanitised) so generated G-code is named after it.
    safe_name = Path(file.filename).name
    with tempfile.TemporaryDirectory(prefix="plotter-upload-") as tmp:
        source = Path(tmp) / safe_name
        with source.open("wb") as fh:
            shutil.copyfileobj(file.file, fh)
        result = convert_with_calibration(source, jobs_dir(), cal)
    return {"files": [_job_info(p).model_dump() for p in result.gcode_files]}


@router.get("/jobs/{filename}")
def download_job(filename: str) -> FileResponse:
    path = _job_path(filename)
    return FileResponse(path, media_type="text/plain", filename=path.name)


@router.delete("/jobs/{filename}")
def delete_job(filename: str) -> dict:
    (jobs_dir() / Path(filename).name).unlink(missing_ok=True)
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
    src.rename(dst)
    return _job_info(dst, Calibration.load())


@router.get("/jobs/{filename}/preview")
def job_preview(filename: str) -> dict:
    return parse_gcode(_job_path(filename))


@router.get("/jobs/{filename}/preview3d")
def job_preview_3d(filename: str) -> dict:
    return parse_gcode_3d(_job_path(filename))


@router.post("/testpattern/{name}")
def make_test_pattern(name: str) -> dict:
    if name not in TEST_PATTERNS:
        raise HTTPException(404, f"unknown pattern: {name}")
    cal = Calibration.load()
    gcode = test_pattern(name, cal)
    out = jobs_dir() / f"test-{name}-{int(time.time())}.gcode"
    out.write_text(gcode)
    return _job_info(out).model_dump()
