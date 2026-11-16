from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from plotter.web.deps import paper_service
from plotter.web.project_context import calibration_profile

router = APIRouter(tags=["paper"])


def _paper_service(project_id: str | None, profile_id: str | None = None, *, capture: bool = False):
    if project_id is None and profile_id is None:
        return paper_service()
    return paper_service(
        profile_id=calibration_profile(project_id, profile_id, motion=capture)["id"]
    )


@router.get("/paper")
def get_paper(project_id: str | None = None, profile_id: str | None = None) -> dict:
    return _paper_service(project_id, profile_id).state()


class CornerRequest(BaseModel):
    corner: str  # bl | br | tr | tl


class CornerAtRequest(BaseModel):
    x: float
    y: float


@router.post("/paper/corner")
def set_paper_corner(
    req: CornerRequest, project_id: str | None = None, profile_id: str | None = None
) -> dict:
    """Store the current head position as one of the paper corners."""
    return _paper_service(project_id, profile_id, capture=True).capture(req.corner)


@router.put("/paper/corner/{corner}")
def set_paper_corner_at(
    corner: str, req: CornerAtRequest, project_id: str | None = None, profile_id: str | None = None
) -> dict:
    """Set a corner to explicit coordinates (no machine movement)."""
    return _paper_service(project_id, profile_id).set_corner_at(corner, req.x, req.y)


@router.delete("/paper/corner/{corner}")
def delete_paper_corner(
    corner: str, project_id: str | None = None, profile_id: str | None = None
) -> dict:
    return _paper_service(project_id, profile_id).clear(corner)


@router.delete("/paper")
def reset_paper(project_id: str | None = None, profile_id: str | None = None) -> dict:
    return _paper_service(project_id, profile_id).reset()


class ObstaclesRequest(BaseModel):
    obstacles: list[dict]


@router.put("/paper/obstacles")
def set_obstacles(
    req: ObstaclesRequest, project_id: str | None = None, profile_id: str | None = None
) -> dict:
    """Replace the no-go obstacle list in the active calibration profile."""
    return _paper_service(project_id, profile_id).set_obstacles(req.obstacles)


class PaperApplyRequest(BaseModel):
    margin: float = Field(default=0.0, ge=0, allow_inf_nan=False)
    from_paper: bool = False


@router.post("/paper/apply")
def apply_paper(
    req: PaperApplyRequest, project_id: str | None = None, profile_id: str | None = None
) -> dict:
    """Inset the general plot area, optionally first replacing it from paper corners."""
    return _paper_service(project_id, profile_id).apply(req.margin, from_paper=req.from_paper)
