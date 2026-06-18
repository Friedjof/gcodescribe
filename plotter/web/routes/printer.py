from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...calibration import Calibration
from ...jobmeta import job_profile_status, read_job_meta_checked
from ...printer.manager import BackendBusyError, BackendUnavailableError
from ...safety import GcodeSafetyChecker, SafetyViolation
from ...services import PrinterController
from ...services.profiles import ProfileService, profile_meta
from ...storage import jobs_dir

log = logging.getLogger(__name__)

router = APIRouter(tags=["printer"])


def controller() -> PrinterController:
    return PrinterController()


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


@router.post("/printer/send")
def octo_send(req: PrintRequest) -> dict:
    ctrl = controller()
    path = jobs_dir() / Path(req.filename).name
    if not path.exists():
        raise HTTPException(404, "Job nicht gefunden")
    # Profile guard first: id + fingerprint must match the active profile.
    # Read profile and calibration in one go so a concurrent profile switch
    # cannot pass the guard with one profile and the safety check with another.
    service = ProfileService()
    active = service.active()
    profiles = {p["id"]: p for p in service.list(include_archived=True)}
    _require_profile_match(path, profile_meta(active), profiles)
    # Re-validate against the *current* calibration: catches jobs generated
    # before a recalibration (other pen heights / plot area) or by old code.
    cal = Calibration().merged(active["calibration"])
    try:
        GcodeSafetyChecker(cal).check(path.read_text(), name=req.filename)
    except SafetyViolation as exc:
        log.warning("Print blocked (safety): %s — %s", path.name, exc)
        raise
    if req.start:
        ctrl.home()
    return ctrl.client.upload(path, start=req.start)


class JobCommand(BaseModel):
    command: str  # start | pause | cancel | restart
    force: bool = False  # accepted for old clients; starts now always home automatically


@router.post("/printer/job")
def octo_job(req: JobCommand) -> dict:
    ctrl = controller()
    if req.command in ("start", "restart"):
        ctrl.home()
    ctrl.client.job_command(req.command)
    return {"ok": True}


class JogRequest(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    speed: int | None = None
    limit: str = "bed"  # bed | plot


@router.post("/printer/jog")
def octo_jog(req: JogRequest) -> dict:
    return {
        "ok": True,
        "position": controller().jog(req.x, req.y, req.z, req.speed, limit=req.limit),
    }


class HomeRequest(BaseModel):
    axes: list[str] | None = None


@router.post("/printer/home")
def octo_home(req: HomeRequest) -> dict:
    return {"ok": True, "position": controller().home(req.axes)}


class MoveRequest(BaseModel):
    x: float
    y: float
    pen_up_first: bool = True  # lift the pen before travelling
    limit: str = "bed"  # bed | plot


@router.post("/printer/move")
def octo_move(req: MoveRequest) -> dict:
    """Absolute XY move (used by click-to-move in the live view)."""
    position = controller().move_to(
        req.x, req.y, pen_up_first=req.pen_up_first, limit=req.limit
    )
    return {"ok": True, "position": position}


class CornerMoveRequest(BaseModel):
    corner: str  # bl | br | tr | tl
    target: str = "paper"  # paper | plot


@router.post("/printer/move-to-corner")
def octo_move_to_corner(req: CornerMoveRequest) -> dict:
    """Drive to a corner; the pen is always lifted before the XY travel."""
    position = controller().move_to_corner(req.corner, target=req.target)
    return {"ok": True, "position": position}


class PenRequest(BaseModel):
    down: bool


@router.post("/printer/pen")
def octo_pen(req: PenRequest) -> dict:
    """Raise or lower the pen using the calibrated Z heights."""
    result = controller().pen(req.down)
    return {"ok": True, **result}


class GcodeRequest(BaseModel):
    commands: list[str]


@router.post("/printer/gcode")
def octo_gcode(req: GcodeRequest) -> dict:
    controller().raw_gcode(req.commands)
    return {"ok": True}
