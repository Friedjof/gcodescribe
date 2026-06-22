from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ...ai_images.config import load_config
from ...ai_images.errors import AiImageError
from ...ai_images.service import AiImageService

router = APIRouter(tags=["ai-images"])

# The whole router is mounted behind require_admin (see web/app.py): the AI
# designer costs money and processes uploaded images, so it is admin-only.


@router.get("/ai-images/status")
def ai_image_status() -> dict:
    """Feature-gating source of truth. Safe subset only; never the API key."""
    return load_config().status()


@router.post("/ai-images/generate")
async def ai_image_generate(
    file: UploadFile = File(...),
    instructions: str = Form(""),
    feedback: str = Form(""),
    base_variant_id: str = Form(""),
    title: str = Form(""),
    render_mode: str = Form("edges"),
    detail: int = Form(2),
) -> dict:
    if not file.filename:
        raise HTTPException(400, "Dateiname fehlt")
    config = load_config()
    if not config.enabled:
        raise AiImageError("not_configured", "AI Designer ist nicht konfiguriert.")
    # Read at most one byte past the limit so an oversized upload never lands
    # fully in memory; the service re-checks and reports the proper category.
    max_bytes = config.max_input_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    return AiImageService(config).generate(
        filename=file.filename,
        data=data,
        mime=file.content_type or "",
        instructions=instructions,
        feedback=feedback,
        base_variant_id=base_variant_id or None,
        title=title,
        render_mode=render_mode,
        detail=detail,
    )
