from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...calibration import Calibration
from ...document import get_document_store
from ...gallery_metrics import evaluate_gcode
from ...gcode_preview import parse_gcode_3d_text
from ...pipeline import PlotterError
from ...scene import page_polylines, save_scene_job, scene_gcode
from ...services.profiles import ProfileService, profile_meta
from ...services.upload_validation import MAX_GCODE_BYTES
from ...singleline import text_polylines
from .jobs import _job_info

router = APIRouter(tags=["pages"])


def store():
    return get_document_store()


def _profiles_by_id(service: ProfileService) -> dict[str, dict]:
    return {p["id"]: p for p in service.list(include_archived=True)}


def _page_profile_status(page: dict, active: dict, profiles: dict[str, dict]) -> str:
    """active | other | stale | missing | archived — computed at request time."""
    profile_id = page.get("profileId")
    if not profile_id:
        return "missing"
    profile = profiles.get(profile_id)
    if profile is None:
        return "missing"
    if profile.get("archived"):
        return "archived"
    if profile_id != active["id"]:
        return "other"
    if page.get("profileFingerprint") != active["fingerprint"]:
        return "stale"
    return "active"


@router.get("/pages")
def list_pages() -> dict:
    """Ordered page metadata + the active page id + the active profile."""
    index = store().list_pages()
    service = ProfileService()
    active = service.active_profile_meta()
    profiles = _profiles_by_id(service)
    return {
        **index,
        "order": [
            {**meta, "profileStatus": _page_profile_status(meta, active, profiles)}
            for meta in index["order"]
        ],
        "activeProfile": active,
    }


@router.get("/pages/{page_id}")
def get_page(page_id: str) -> dict:
    page = store().get_page(page_id)
    if not page:
        raise HTTPException(404, "Seite nicht gefunden")
    service = ProfileService()
    active = service.active_profile_meta()
    return {**page, "profileStatus": _page_profile_status(page, active, _profiles_by_id(service))}


class CreateRequest(BaseModel):
    name: str | None = None


class ExpectedProfileRequest(BaseModel):
    expected_profile_id: str | None = None
    expected_profile_fingerprint: str | None = None


def _require_expected_profile(req: ExpectedProfileRequest | None, active: dict) -> None:
    if req is None:
        return
    if req.expected_profile_id and req.expected_profile_id != active["id"]:
        raise HTTPException(
            409,
            "Das aktive Profil wurde in der Zwischenzeit gewechselt. Bitte die Seite neu laden.",
        )
    if (
        req.expected_profile_fingerprint
        and req.expected_profile_fingerprint != active["fingerprint"]
    ):
        raise HTTPException(
            409,
            "Das aktive Profil wurde in der Zwischenzeit geändert. Bitte die Seite neu laden.",
        )


@router.post("/pages")
def create_page(req: CreateRequest) -> dict:
    return store().create_page(req.name, profile=ProfileService().active_profile_meta())


class SaveRequest(BaseModel):
    objects: list | None = None
    grid: dict | None = None
    name: str | None = None
    markdown: str | None = None


class TextPreviewRequest(BaseModel):
    text: str = "Text"
    font: str = "sans"
    size: float = 12.0
    connect_spaces: bool = False


@router.put("/pages/{page_id}")
def save_page(page_id: str, req: SaveRequest) -> dict:
    try:
        return store().save_page(page_id, req.model_dump(exclude_none=True))
    except KeyError as exc:
        raise HTTPException(404, "Seite nicht gefunden") from exc


@router.delete("/pages/{page_id}")
def delete_page(page_id: str) -> dict:
    return store().delete_page(page_id)


@router.post("/pages/{page_id}/duplicate")
def duplicate_page(page_id: str) -> dict:
    try:
        return store().duplicate_page(page_id)
    except KeyError as exc:
        raise HTTPException(404, "Seite nicht gefunden") from exc


@router.post("/pages/{page_id}/activate")
def activate_page(page_id: str) -> dict:
    return store().set_active(page_id)


class ReorderRequest(BaseModel):
    ids: list[str]


@router.post("/pages/reorder")
def reorder_pages(req: ReorderRequest) -> dict:
    return store().reorder_pages(req.ids)


@router.post("/pages/{page_id}/gcode")
def page_gcode(page_id: str, req: ExpectedProfileRequest | None = None) -> dict:
    page = store().get_page(page_id)
    if not page:
        raise HTTPException(404, "Seite nicht gefunden")
    # Page and active profile must match exactly: same id, same fingerprint.
    # A page laid out for another plot area would silently draw at the wrong
    # bed position; the user has to activate or adopt the profile explicitly.
    service = ProfileService()
    profile = service.active()
    active = profile_meta(profile)
    _require_expected_profile(req, active)
    status = _page_profile_status(page, active, _profiles_by_id(service))
    if status == "missing":
        if page.get("profileId"):
            raise HTTPException(
                409,
                f"Das Profil „{page.get('profileName')}“ existiert nicht mehr. Bitte die "
                "Seite explizit für das aktive Profil übernehmen.",
            )
        raise HTTPException(
            409,
            "Die Seite hat kein Profil (Legacy). Bitte sie zuerst explizit "
            "für das aktive Profil übernehmen.",
        )
    if status == "other":
        raise HTTPException(
            409,
            f"Die Seite gehört zu Profil „{page.get('profileName')}“ — aktiv "
            f"ist „{active['name']}“. Bitte das passende Profil aktivieren.",
        )
    if status == "archived":
        raise HTTPException(
            409,
            f"Die Seite gehört zu Profil „{page.get('profileName')}“, aber dieses Profil "
            "ist archiviert. Bitte das Profil wiederherstellen oder die Seite explizit "
            "für das aktive Profil übernehmen.",
        )
    if status == "stale":
        raise HTTPException(
            409,
            f"Profil „{active['name']}“ wurde seit Erstellung der Seite "
            "geändert. Bitte die Seite prüfen und das Profil neu übernehmen.",
        )
    cal = Calibration().merged(profile["calibration"])
    path = save_scene_job(page, cal, profile=active)
    return _job_info(path, active_profile=active).model_dump()


class AdoptRequest(ExpectedProfileRequest):
    force: bool = False  # adopt even though objects fall outside the plot area


@router.post("/pages/{page_id}/adopt-profile")
def adopt_profile(page_id: str, req: AdoptRequest) -> dict:
    """Explicitly bind a page to the active profile.

    Used for legacy pages, pages from other profiles and stale pages. The
    content is never scaled or moved; if it does not fit the active plot
    area, adoption is refused unless forced.
    """
    page = store().get_page(page_id)
    if not page:
        raise HTTPException(404, "Seite nicht gefunden")
    profile = ProfileService().active()
    active = profile_meta(profile)
    _require_expected_profile(req, active)
    if not req.force:
        cal = Calibration().merged(profile["calibration"])
        points = [pt for line in page_polylines(page) for pt in line]
        eps = 0.001
        if any(
            x < -eps or y < -eps or x > cal.plot_width + eps or y > cal.plot_height + eps
            for x, y in points
        ):
            raise HTTPException(
                409,
                "Die Seite ragt über den Plotbereich des aktiven Profils "
                f"hinaus ({cal.plot_width:g} × {cal.plot_height:g} mm). "
                "Inhalte werden nicht automatisch skaliert.",
            )
    updated = store().set_page_profile(page_id, active)
    return {
        **updated,
        "profileStatus": _page_profile_status(
            updated,
            active,
            _profiles_by_id(ProfileService()),
        ),
    }


class SceneRequest(BaseModel):
    """Optional live canvas objects, overriding the persisted page state."""

    objects: list | None = None


def _page_for_preview(page_id: str, objects: list | None) -> dict:
    page = store().get_page(page_id)
    if not page:
        raise HTTPException(404, "Seite nicht gefunden")
    return {**page, "objects": objects} if objects is not None else page


@router.post("/pages/{page_id}/score")
def page_score(page_id: str, req: SceneRequest) -> dict:
    """Transient plottability rating of the canvas — no job file is written.

    Uses the same central G-code evaluation as the gallery, so the designer
    score matches what a submission of this drawing would get.
    """
    page = _page_for_preview(page_id, req.objects)
    try:
        gcode = scene_gcode(page, Calibration.load())
    except PlotterError as exc:
        return {"score": None, "metrics": None, "reason": str(exc)}
    return {**evaluate_gcode(gcode, MAX_GCODE_BYTES), "reason": None}


@router.post("/pages/{page_id}/preview3d")
def page_preview_3d(page_id: str, req: SceneRequest) -> dict:
    """3D tool-path preview of the current canvas without saving a job."""
    page = _page_for_preview(page_id, req.objects)
    try:
        gcode = scene_gcode(page, Calibration.load())
    except PlotterError as exc:
        raise HTTPException(400, str(exc)) from exc
    return parse_gcode_3d_text(gcode)


@router.post("/paint/text-polylines")
def paint_text_polylines(req: TextPreviewRequest) -> dict:
    return {
        "polylines": text_polylines(
            req.text, font=req.font, size=req.size, connect_spaces=req.connect_spaces
        )
    }
