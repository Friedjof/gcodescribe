from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from plotter.artwork.pipeline import PlotterError
from plotter.artwork.xopp import read_xopp_bytes
from plotter.services.asset_pages import VALID_MODES, render_drawing
from plotter.services.asset_tasks import asset_tasks
from plotter.services.project_render import page_project_profile
from plotter.services.upload_validation import MAX_UPLOAD_BYTES, sniff_asset_kind

router = APIRouter(tags=["asset-tasks"])


class Target(BaseModel):
    page_id: str
    project_id: str | None = None
    profile_id: str | None = None
    fingerprint: str | None = None
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    width: float = Field(gt=0, allow_inf_nan=False)
    height: float = Field(gt=0, allow_inf_nan=False)


class RenderRequest(BaseModel):
    mode: str = "auto"
    detail: int = Field(default=2, ge=1, le=3)
    continuous: bool = True


@router.get("/asset-tasks")
def list_tasks() -> list[dict]:
    return asset_tasks().list()


@router.post("/asset-tasks/xopp-preview")
async def preview_xopp(file: UploadFile = File(...)) -> dict:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Datei zu groß.")
    if await run_in_threadpool(sniff_asset_kind, file.filename or "", data) != "xopp":
        raise HTTPException(415, "Nur Xournal++-Dateien werden akzeptiert.")
    try:
        pages = await run_in_threadpool(read_xopp_bytes, data)
    except PlotterError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"pages": [
        {"n": n, "strokes": len(page.polylines), "preview": render_drawing(page, 600)}
        for n, page in enumerate(pages, start=1)
    ]}


@router.post("/asset-tasks/import", status_code=202)
async def import_asset(
    file: UploadFile = File(...),
    title: str = Form(""),
    mode: str = Form("auto"),
    detail: int = Form(2),
    target: str = Form(""),
    selected_pages: str = Form(""),
    client_id: str = Form(""),
) -> dict:
    try:
        task_id = uuid.UUID(client_id).hex if client_id else uuid.uuid4().hex
    except ValueError as exc:
        raise HTTPException(422, "Ungültige Auftragskennung.") from exc
    if mode not in VALID_MODES or detail not in (1, 2, 3):
        raise HTTPException(422, "Ungültige Render-Einstellungen.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Datei zu groß.")
    kind = await run_in_threadpool(sniff_asset_kind, file.filename or "", data)
    page_numbers = None
    if kind == "xopp":
        try:
            page_numbers = json.loads(selected_pages) if selected_pages else None
            pages = await run_in_threadpool(read_xopp_bytes, data)
        except (ValueError, PlotterError) as exc:
            raise HTTPException(422, str(exc)) from exc
        if page_numbers is None:
            page_numbers = [1] if len(pages) == 1 else []
        if (not isinstance(page_numbers, list) or not 1 <= len(page_numbers) <= 20
                or len(set(map(str, page_numbers))) != len(page_numbers)
                or any(type(n) is not int or n < 1 or n > len(pages) for n in page_numbers)):
            raise HTTPException(422, "Bitte 1 bis 20 gültige Xournal++-Seiten auswählen.")
        if any(not pages[n - 1].polylines for n in page_numbers):
            raise HTTPException(422, "Eine gewählte Seite enthält keine Stiftzüge.")
        if target and len(page_numbers) > 1:
            raise HTTPException(422, "Mehrere Seiten können nur in die Galerie importiert werden.")
    elif selected_pages:
        raise HTTPException(422, "Seitenauswahl ist nur für Xournal++-Dateien möglich.")
    destination = None
    if target:
        try:
            parsed = Target.model_validate(json.loads(target))
            destination = parsed.model_dump()
        except ValueError as exc:
            raise HTTPException(422, "Ungültige Zielposition.") from exc
        page = asset_tasks().documents.get_page(destination["page_id"])
        if page is None:
            raise HTTPException(404, "Zielseite wurde gelöscht.")
        profile, _cal = page_project_profile(page)
        if ((parsed.project_id is not None and parsed.project_id != page.get("projectId"))
                or (parsed.profile_id is not None and parsed.profile_id != profile["id"])
                or (parsed.fingerprint is not None
                    and parsed.fingerprint != profile["fingerprint"])):
            raise HTTPException(
                409, "Die Zielseite oder Projektkalibrierung wurde geändert. "
                "Bitte das Bild im Designer erneut einfügen.",
            )
        destination.update(
            project_id=page["projectId"],
            profile_id=profile["id"],
            fingerprint=profile["fingerprint"],
            page_name=page["name"],
        )
    return await run_in_threadpool(
        asset_tasks().submit,
        {
            "kind": "import",
            "id": task_id,
            "filename": file.filename or "image",
            "title": title,
            "mode": mode,
            "detail": detail,
            "target": destination,
            "selected_pages": page_numbers,
        },
        data,
    )


@router.post("/asset-tasks/render/{item_id}", status_code=202)
def render_asset(item_id: str, request: RenderRequest) -> dict:
    if request.mode not in VALID_MODES:
        raise HTTPException(422, "Ungültiger Render-Modus.")
    service = asset_tasks()
    meta = service.gallery.get(item_id)
    service.gallery.original_path(item_id)
    return service.submit(
        {
            "kind": "render",
            "item_id": item_id,
            "filename": meta["filename"],
            "expected_revision": meta.get("render_revision", meta["created"]),
            **request.model_dump(),
        }
    )


@router.post("/asset-tasks/{task_id}/{action}")
def update_task(task_id: str, action: str) -> dict:
    if action not in {"cancel", "retry"}:
        raise HTTPException(404)
    try:
        return getattr(asset_tasks(), action)(task_id)
    except KeyError as exc:
        raise HTTPException(404, "Auftrag nicht gefunden.") from exc


@router.delete("/asset-tasks/{task_id}")
def dismiss_task(task_id: str) -> dict:
    try:
        asset_tasks().dismiss(task_id)
    except KeyError as exc:
        raise HTTPException(404, "Auftrag nicht gefunden.") from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True}
