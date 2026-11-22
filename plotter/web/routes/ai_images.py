from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from ...ai_images.config import load_config
from ...ai_images.errors import AiImageError
from ...ai_images.service import AiImageService

router = APIRouter(tags=["ai-images"])


@router.get("/ai-images/codex/status")
def codex_status() -> dict:
    from ...ai_images.codex import get_codex

    return get_codex().status()


@router.post("/ai-images/codex/login")
def codex_login() -> dict:
    from ...ai_images.codex import get_codex

    return get_codex().login()


class CodexLoginCancel(BaseModel):
    loginId: str


@router.post("/ai-images/codex/login/cancel")
def codex_cancel(req: CodexLoginCancel) -> dict:
    from ...ai_images.codex import get_codex

    get_codex().cancel_login(req.loginId)
    return {"ok": True}


@router.post("/ai-images/codex/logout")
def codex_logout() -> dict:
    from ...ai_images.codex import get_codex

    get_codex().logout()
    return {"ok": True}


# The whole router is mounted behind require_admin (see web/app.py): the AI
# designer costs money and processes uploaded images, so it is admin-only.


@router.get("/ai-images/status")
def ai_image_status() -> dict:
    """Feature-gating source of truth. Safe subset only; never the API key."""
    return load_config().status()


@router.post("/ai-images/generate")
async def ai_image_generate(
    file: UploadFile | None = File(None),
    instructions: str = Form(""),
    feedback: str = Form(""),
    base_variant_id: str = Form(""),
    title: str = Form(""),
    render_mode: str = Form("edges"),
    detail: int = Form(2),
    effect: str = Form("none"),
    text_style: str = Form("none"),
    detail_level: int = Form(5),
    aspect_ratio: str = Form("auto"),
) -> dict:
    config = load_config()
    if not config.enabled:
        raise AiImageError("not_configured", "AI Designer ist nicht konfiguriert.")
    # A file is optional: text-only requests generate from the prompt, and
    # feedback requests without an upload iterate on the parent variant. Read at
    # most one byte past the limit so an oversized upload never lands fully in
    # memory; the service re-checks and reports the category.
    filename = ""
    mime = ""
    data: bytes | None = None
    if file is not None and file.filename:
        filename = file.filename
        mime = file.content_type or ""
        data = await file.read(config.max_input_mb * 1024 * 1024 + 1)
    if data is None and not base_variant_id and not instructions.strip():
        raise HTTPException(400, "Bild oder Prompt erforderlich")
    return await run_in_threadpool(
        AiImageService(config).generate,
        filename=filename,
        data=data,
        mime=mime,
        instructions=instructions,
        feedback=feedback,
        base_variant_id=base_variant_id or None,
        title=title,
        render_mode=render_mode,
        detail=detail,
        effect=effect,
        text_style=text_style,
        detail_level=detail_level,
        aspect_ratio=aspect_ratio,
    )


class RerenderRequest(BaseModel):
    render_mode: str = "edges"
    detail: int = 2


@router.post("/ai-images/{item_id}/rerender")
def ai_image_rerender(item_id: str, req: RerenderRequest) -> dict:
    """Re-trace an existing AI variant in a different mode/detail (no new
    generation, no provider call)."""
    config = load_config()
    if not config.enabled:
        raise AiImageError("not_configured", "AI Designer ist nicht konfiguriert.")
    return AiImageService(config).rerender_variant(
        item_id, render_mode=req.render_mode, detail=req.detail
    )


@router.post("/ai-images/{item_id}/save")
def ai_image_save(item_id: str) -> dict:
    """Promote a draft AI variant into a normal, listed gallery item."""
    config = load_config()
    if not config.enabled:
        raise AiImageError("not_configured", "AI Designer ist nicht konfiguriert.")
    return AiImageService(config).save_variant(item_id)
