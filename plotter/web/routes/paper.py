from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from ...services import PaperService

router = APIRouter(tags=["paper"])


def service() -> PaperService:
    return PaperService()


@router.get("/paper")
def get_paper() -> dict:
    return service().state()


class CornerRequest(BaseModel):
    corner: str  # bl | br | tr | tl


class CornerAtRequest(BaseModel):
    x: float
    y: float


@router.post("/paper/corner")
def set_paper_corner(req: CornerRequest) -> dict:
    """Store the current head position as one of the paper corners."""
    return service().capture(req.corner)


@router.put("/paper/corner/{corner}")
def set_paper_corner_at(corner: str, req: CornerAtRequest) -> dict:
    """Set a corner to explicit coordinates (no machine movement)."""
    return service().set_corner_at(corner, req.x, req.y)


@router.delete("/paper/corner/{corner}")
def delete_paper_corner(corner: str) -> dict:
    return service().clear(corner)


@router.delete("/paper")
def reset_paper() -> dict:
    return service().reset()


class ObstaclesRequest(BaseModel):
    obstacles: list[dict]


@router.put("/paper/obstacles")
def set_obstacles(req: ObstaclesRequest) -> dict:
    """Replace the no-go obstacle list in the active calibration profile."""
    return service().set_obstacles(req.obstacles)


class PaperApplyRequest(BaseModel):
    margin: float = 0.0


@router.post("/paper/apply")
def apply_paper(req: PaperApplyRequest) -> dict:
    """Turn the captured corners (minus margin) into the active plot area."""
    return service().apply(req.margin)
