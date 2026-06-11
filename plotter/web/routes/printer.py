from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...calibration import Calibration
from ...safety import GcodeSafetyChecker
from ...services import PrinterController
from ...storage import jobs_dir

router = APIRouter(tags=["printer"])


def controller() -> PrinterController:
    return PrinterController()


@router.get("/octoprint/status")
def octo_status() -> dict:
    return controller().status()


@router.get("/position")
def get_position() -> dict:
    return controller().position()


class PrintRequest(BaseModel):
    filename: str
    start: bool = False
    force: bool = False  # start even though the position is unknown


def _require_homed(ctrl: PrinterController) -> None:
    if not ctrl.tracker.homed:
        raise HTTPException(
            409,
            "Drucken verweigert: Position unbekannt. Bitte zuerst homen "
            "(Papier-Tab, Schritt 1) — sonst stimmt die Stift-Höhe nicht.",
        )


@router.post("/octoprint/send")
def octo_send(req: PrintRequest) -> dict:
    ctrl = controller()
    if req.start and not req.force:
        _require_homed(ctrl)
    path = jobs_dir() / Path(req.filename).name
    if not path.exists():
        raise HTTPException(404, "job not found")
    # Re-validate against the *current* calibration: catches jobs generated
    # before a recalibration (other pen heights / plot area) or by old code.
    GcodeSafetyChecker(Calibration.load()).check(path.read_text(), name=req.filename)
    return ctrl.client.upload(path, start=req.start)


class JobCommand(BaseModel):
    command: str  # start | pause | cancel | restart
    force: bool = False


@router.post("/octoprint/job")
def octo_job(req: JobCommand) -> dict:
    ctrl = controller()
    if req.command in ("start", "restart") and not req.force:
        _require_homed(ctrl)
    ctrl.client.job_command(req.command)
    return {"ok": True}


class JogRequest(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    speed: int | None = None
    limit: str = "bed"  # bed | plot


@router.post("/octoprint/jog")
def octo_jog(req: JogRequest) -> dict:
    return {
        "ok": True,
        "position": controller().jog(req.x, req.y, req.z, req.speed, limit=req.limit),
    }


class HomeRequest(BaseModel):
    axes: list[str] | None = None


@router.post("/octoprint/home")
def octo_home(req: HomeRequest) -> dict:
    return {"ok": True, "position": controller().home(req.axes)}


class MoveRequest(BaseModel):
    x: float
    y: float
    pen_up_first: bool = True  # lift the pen before travelling
    limit: str = "bed"  # bed | plot


@router.post("/octoprint/move")
def octo_move(req: MoveRequest) -> dict:
    """Absolute XY move (used by click-to-move in the live view)."""
    position = controller().move_to(
        req.x, req.y, pen_up_first=req.pen_up_first, limit=req.limit
    )
    return {"ok": True, "position": position}


class CornerMoveRequest(BaseModel):
    corner: str  # bl | br | tr | tl
    target: str = "paper"  # paper | plot


@router.post("/octoprint/move-to-corner")
def octo_move_to_corner(req: CornerMoveRequest) -> dict:
    """Drive to a corner; the pen is always lifted before the XY travel."""
    position = controller().move_to_corner(req.corner, target=req.target)
    return {"ok": True, "position": position}


class PenRequest(BaseModel):
    down: bool


@router.post("/octoprint/pen")
def octo_pen(req: PenRequest) -> dict:
    """Raise or lower the pen using the calibrated Z heights."""
    result = controller().pen(req.down)
    return {"ok": True, **result}


class GcodeRequest(BaseModel):
    commands: list[str]


@router.post("/octoprint/gcode")
def octo_gcode(req: GcodeRequest) -> dict:
    controller().raw_gcode(req.commands)
    return {"ok": True}
