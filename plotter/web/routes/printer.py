from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from plotter.core.calibration import Calibration, PositionKind
from plotter.core.jobmeta import job_profile_status, read_job_meta_checked
from plotter.core.storage import jobs_dir
from plotter.gcode.pressure import job_uses_pressure
from plotter.gcode.safety import GcodeSafetyChecker, SafetyViolation
from plotter.web.deps import printer_controller, profile_service
from plotter.web.project_context import project_calibration

from ...printer.manager import BackendBusyError, BackendUnavailableError
from ...services import PrinterController
from ...services.profiles import profile_meta
from ...services.project_render import ProjectJobError
from ...services.project_render import project_job_calibration as _project_job_calibration

log = logging.getLogger(__name__)

router = APIRouter(tags=["printer"])


def controller() -> PrinterController:
    return printer_controller()


@router.get("/printer/status")
def octo_status() -> dict:
    return controller().status()


@router.get("/printer/backends")
def list_backends() -> list[dict]:
    """Configured backends with availability — drives the frontend selector."""
    client = controller().client
    backends = getattr(client, "backends", None)
    if not callable(backends):
        return []
    return backends()


@router.get("/printer/serial/ports")
def list_serial_ports() -> list[dict]:
    from ...printer.discovery import list_candidates

    return [candidate.as_dict() for candidate in list_candidates()]


class SerialProbeRequest(BaseModel):
    device: str


@router.post("/printer/serial/probe")
def serial_probe(req: SerialProbeRequest) -> dict:
    """Actively identify a port (M115). Refused while serial holds the port."""
    from ...printer.discovery import probe
    from ...printer.serial import peek_worker

    worker = peek_worker()
    if worker is not None and worker.status().get("online"):
        raise HTTPException(
            409, "Serial ist gerade aktiv — zum Prüfen erst auf OctoPrint umschalten."
        )
    return probe(req.device)


@router.get("/printer/octoprint/check")
def octoprint_check() -> dict:
    """Probe OctoPrint reachability with the currently saved settings."""
    from plotter.core.config import load_settings

    from ...printer.octoprint import OctoPrintClient, OctoPrintError
    from ...services.settings_store import load_saved

    cfg = load_settings(load_saved()).printer
    client = OctoPrintClient(base_url=cfg.octoprint_url, api_key=cfg.octoprint_api_key)
    if not client.configured:
        return {
            "ok": False,
            "error": "OctoPrint nicht konfiguriert (URL oder API-Schlüssel fehlt).",
        }
    try:
        resp = client._request("GET", "/api/version")
        data = resp.json()
        return {"ok": True, "version": data.get("server", "?"), "api": data.get("api", "?")}
    except OctoPrintError as exc:
        return {"ok": False, "error": str(exc)}


class BackendSelect(BaseModel):
    id: str  # octoprint | serial


@router.post("/printer/backend")
def set_backend(req: BackendSelect) -> dict:
    client = controller().client
    set_active = getattr(client, "set_active", None)
    if not callable(set_active):
        raise HTTPException(400, "Backend-Umschaltung nicht verfügbar")
    try:
        set_active(req.id)
    except BackendBusyError as exc:
        raise HTTPException(409, str(exc)) from exc
    except BackendUnavailableError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "active": client.active_id}


@router.get("/position")
def get_position() -> dict:
    return controller().position()


class PrintRequest(BaseModel):
    filename: str
    start: bool = False
    force: bool = False  # accepted for old clients; starts now always home automatically


def _refuse_print(filename: str, reason: str, message: str) -> None:
    """Block a print attempt with a 409 and leave an audit trail in the log."""
    log.warning("Print blocked (%s): %s — %s", reason, filename, message)
    raise HTTPException(409, message)


def _require_profile_match(
    path: Path,
    active_profile: dict,
    profiles: dict[str, dict],
) -> None:
    """Server-side profile guard — runs before the geometric safety check.

    A job from another profile can be geometrically valid and still draw at
    the wrong bed position, so the frontend's disabled buttons are not enough.
    """
    meta, meta_issue = read_job_meta_checked(path)
    if meta_issue:
        _refuse_print(path.name, "corrupt-meta", f"Drucken verweigert: {meta_issue}")
    status = job_profile_status(meta, active_profile, profiles)
    if status["legacy"]:
        _refuse_print(
            path.name,
            "legacy",
            "Drucken verweigert: Job hat keine Profil-Metadaten (Legacy). "
            "Bitte den Job mit dem aktiven Profil neu erzeugen.",
        )
    if status["stale"]:
        _refuse_print(
            path.name,
            "stale",
            f"Drucken verweigert: Profil „{status['name']}“ wurde seit der "
            "Job-Erzeugung geändert. Bitte den Job neu erzeugen.",
        )
    if status["missing"]:
        _refuse_print(
            path.name,
            "missing-profile",
            f"Drucken verweigert: Das Profil „{status['name']}“ existiert nicht mehr. "
            "Bitte den Job mit dem aktiven Profil neu erzeugen.",
        )
    if status["archived"]:
        _refuse_print(
            path.name,
            "archived-profile",
            f"Drucken verweigert: Profil „{status['name']}“ ist archiviert. "
            "Bitte das Profil wiederherstellen oder den Job neu erzeugen.",
        )
    if not status["matchesActive"]:
        _refuse_print(
            path.name,
            "foreign-profile",
            f"Drucken verweigert: Job gehört zu Profil „{status['name']}“, "
            f"aktiv ist „{active_profile['name']}“. Bitte das passende Profil "
            "aktivieren oder den Job neu erzeugen.",
        )


def _validated_job_calibration(path: Path) -> Calibration:
    """Read and validate a local job before uploading or starting any motion."""
    if not path.is_file():
        raise HTTPException(404, "Job nicht gefunden")
    # Designer jobs carry their slide's calibration. Other jobs retain the
    # existing active-profile guard, including legacy and imported G-code.
    service = profile_service()
    meta, meta_issue = read_job_meta_checked(path)
    if meta_issue:
        _refuse_print(path.name, "corrupt-meta", f"Drucken verweigert: {meta_issue}")
    source = (meta or {}).get("source") or {}
    if source.get("project_id") and source.get("kind") in (
        "paint_page", "paint_coloring", "testpattern",
    ):
        try:
            cal = _project_job_calibration(meta)
        except ProjectJobError as exc:
            _refuse_print(path.name, "project-job", str(exc))
    else:
        active = service.active()
        profiles = {p["id"]: p for p in service.list(include_archived=True)}
        _require_profile_match(path, profile_meta(active), profiles)
        cal = Calibration.from_dict(active["calibration"])
    try:
        GcodeSafetyChecker(cal, allow_pressure=job_uses_pressure(meta)).check(
            path.read_text(), name=path.name,
        )
    except SafetyViolation as exc:
        log.warning("Print blocked (safety): %s — %s", path.name, exc)
        raise
    return cal


@router.post("/printer/send")
def octo_send(req: PrintRequest) -> dict:
    ctrl = controller()
    path = jobs_dir() / Path(req.filename).name
    cal = _validated_job_calibration(path)
    if req.start:
        ctrl.home(cal=cal)
    return ctrl.client.upload(path, start=req.start)


class JobCommand(BaseModel):
    command: str  # start | pause | resume | cancel | restart
    force: bool = False  # accepted for old clients; starts now always home automatically


@router.post("/printer/job")
def octo_job(req: JobCommand) -> dict:
    ctrl = controller()
    if req.command in ("start", "restart"):
        job = ctrl.status().get("job") or {}
        selected = (job.get("job") or {}).get("file") or {}
        filename = selected.get("name") or selected.get("path")
        if not isinstance(filename, str) or not filename.strip():
            _refuse_print(
                "unbekannt", "unknown-selected-job",
                "Der ausgewählte Druckjob kann nicht geprüft werden. "
                "Bitte im Designer erneut auf Plot klicken und den Job neu senden.",
            )
        path = jobs_dir() / Path(filename).name
        if not path.is_file():
            _refuse_print(
                path.name, "missing-local-job",
                "Die lokale G-Code-Datei des ausgewählten Druckjobs fehlt. "
                "Bitte im Designer erneut auf Plot klicken und den Job neu senden.",
            )
        cal = _validated_job_calibration(path)
        ctrl.home(cal=cal)
    ctrl.client.job_command(req.command)
    return {"ok": True}


class JogRequest(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    speed: int | None = None
    limit: str = "bed"  # bed | plot
    projectId: str | None = None


@router.post("/printer/jog")
def octo_jog(req: JogRequest) -> dict:
    return {
        "ok": True,
        "position": controller().jog(
            req.x, req.y, req.z, req.speed, limit=req.limit,
            cal=project_calibration(req.projectId),
        ),
    }


class SpeedTestRequest(BaseModel):
    profile_id: str


@router.post("/printer/speed-test")
def speed_test(req: SpeedTestRequest) -> dict:
    active = profile_service().active()
    if active["id"] != req.profile_id:
        raise HTTPException(409, "Das aktive Profil hat sich geändert. Bitte neu öffnen.")
    cal = Calibration.from_dict(active["calibration"])
    return {"ok": True, **controller().speed_test(cal=cal)}


class HomeRequest(BaseModel):
    axes: list[str] | None = None
    projectId: str | None = None


@router.post("/printer/home")
def octo_home(req: HomeRequest) -> dict:
    return {
        "ok": True,
        "position": controller().home(req.axes, cal=project_calibration(req.projectId)),
    }


class MoveRequest(BaseModel):
    x: float
    y: float
    pen_up_first: bool = True  # lift the pen before travelling
    limit: str = "bed"  # bed | plot
    projectId: str | None = None


@router.post("/printer/move")
def octo_move(req: MoveRequest) -> dict:
    """Absolute XY move (used by click-to-move in the live view)."""
    position = controller().move_to(
        req.x, req.y, pen_up_first=req.pen_up_first, limit=req.limit,
        cal=project_calibration(req.projectId),
    )
    return {"ok": True, "position": position}


@router.post("/printer/move-to-calibration")
def move_to_calibration(project_id: str | None = None) -> dict:
    """Prepare pen insertion at the active profile's calibration position."""
    return {
        "ok": True,
        "position": controller().move_to_calibration(cal=project_calibration(project_id)),
    }


class PositionMoveRequest(BaseModel):
    kind: PositionKind
    x: float | None = None
    y: float | None = None
    projectId: str | None = None


@router.post("/printer/move-to-position")
def move_to_position(req: PositionMoveRequest) -> dict:
    return {
        "ok": True,
        "position": controller().move_to_position(
            req.kind, req.x, req.y, cal=project_calibration(req.projectId)
        ),
    }


class PositionVisitRequest(BaseModel):
    kind: PositionKind
    projectId: str | None = None


def _active_project_calibration(project_id: str, profile_id: str | None = None) -> Calibration:
    return project_calibration(project_id, profile_id)


@router.post("/printer/home-and-move-to-position")
def home_and_move_to_position(req: PositionVisitRequest) -> dict:
    cal = _active_project_calibration(req.projectId) if req.projectId else None
    return {"ok": True, "position": controller().home_and_move_to_position(req.kind, cal=cal)}


class CalibrationHeightRequest(BaseModel):
    profile_id: str
    offset: float = Field(ge=-3, le=3, allow_inf_nan=False)
    project_id: str | None = None


@router.post("/printer/calibration-height")
def calibration_height(req: CalibrationHeightRequest) -> dict:
    if req.project_id:
        cal = _active_project_calibration(req.project_id, req.profile_id)
    else:
        active = profile_service().active()
        if active["id"] != req.profile_id:
            raise HTTPException(409, "Das aktive Profil hat sich geändert. Bitte neu öffnen.")
        cal = Calibration.from_dict(active["calibration"])
    return {"ok": True, "position": controller().calibration_height(req.offset, cal=cal)}


class CornerMoveRequest(BaseModel):
    corner: str  # bl | br | tr | tl
    target: str = "paper"  # paper | plot
    projectId: str | None = None


@router.post("/printer/move-to-corner")
def octo_move_to_corner(req: CornerMoveRequest) -> dict:
    """Drive to a corner; the pen is always lifted before the XY travel."""
    position = controller().move_to_corner(
        req.corner, target=req.target, cal=project_calibration(req.projectId)
    )
    return {"ok": True, "position": position}


class PenRequest(BaseModel):
    down: bool
    projectId: str | None = None


@router.post("/printer/pen")
def octo_pen(req: PenRequest) -> dict:
    """Raise or lower the pen using the calibrated Z heights."""
    result = controller().pen(req.down, cal=project_calibration(req.projectId))
    return {"ok": True, **result}


class GcodeRequest(BaseModel):
    commands: list[str]


@router.post("/printer/gcode")
def octo_gcode(req: GcodeRequest) -> dict:
    controller().raw_gcode(req.commands)
    return {"ok": True}
