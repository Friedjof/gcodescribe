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


@router.post("/paper/corner")
def set_paper_corner(req: CornerRequest) -> dict:
    """Store the current head position as one of the paper corners."""
    return service().capture(req.corner)


@router.delete("/paper/corner/{corner}")
def delete_paper_corner(corner: str) -> dict:
    return service().clear(corner)


@router.delete("/paper")
def reset_paper() -> dict:
    return service().reset()


class PaperApplyRequest(BaseModel):
    margin: float = 0.0


@router.post("/paper/apply")
def apply_paper(req: PaperApplyRequest) -> dict:
    """Turn the captured corners (minus margin) into the active plot area."""
    return service().apply(req.margin)
