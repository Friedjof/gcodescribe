from __future__ import annotations

import json
import time
import uuid

from ..pipeline import PlotterError
from ..services.gallery import GalleryService
from ..services.upload_validation import UnsupportedUpload, UploadTooLarge
from .client import AiImageRequest, make_client
from .config import ALLOWED_RENDER_MODES, DEFAULT_RENDER_MODE, AiImageConfig
from .errors import AiImageError
from .prompts import STYLE_PROMPT, compose_prompt, style_prompt_hash
from .quality import assess

# Input image types accepted as a reference. PDFs/Office docs are out for the
# AI flow even though the gallery would accept them.
ALLOWED_INPUT_KINDS = ("png", "jpeg")


class AiImageService:
    """The ``generate`` use case: prompt → provider → gallery asset → preview.

    Every result is a normal admin gallery item, so previews, thumbnails,
    designer import and archiving all reuse the existing, tested gallery paths.
    AI-specific provenance is stored under an ``ai`` key in the item's
    ``meta.json`` and ignored by the rest of the app.
    """

    def __init__(self, config: AiImageConfig, gallery: GalleryService | None = None):
        self.config = config
        self.gallery = gallery or GalleryService()

    def generate(
        self,
        *,
        filename: str,
        data: bytes,
        mime: str = "",
        instructions: str = "",
        feedback: str = "",
        base_variant_id: str | None = None,
        title: str = "",
        render_mode: str = DEFAULT_RENDER_MODE,
        detail: int = 2,
    ) -> dict:
        if not self.config.enabled:
            raise AiImageError("not_configured", "AI Designer ist nicht konfiguriert.")

        render_mode = render_mode if render_mode in ALLOWED_RENDER_MODES else DEFAULT_RENDER_MODE
        detail = max(1, min(int(detail), 3))
        self._validate_input(filename, data)

        prompt = compose_prompt(instructions, feedback)
        client = make_client(self.config)
        output = client.generate_plotter_image(
            AiImageRequest(
                image_bytes=data,
                filename=filename,
                mime=mime,
                prompt=prompt,
                size=self.config.size,
                user_instructions=instructions,
                feedback=feedback,
                parent_variant_id=base_variant_id,
            )
        )
        if not output.image_bytes:
            raise AiImageError("bad_response", "Der AI-Dienst lieferte kein Bild.")

        variant_id = uuid.uuid4().hex[:12]
        out_name = f"ai-plotter-{variant_id}.png"
        item_title = (title or f"AI: {filename.rsplit('.', 1)[0]}").strip()
        try:
            item = self.gallery.create(
                out_name,
                output.image_bytes,
                title=item_title,
                uploader="admin",
                mode=render_mode,
                detail=detail,
            )
        except (PlotterError, UploadTooLarge) as exc:
            raise AiImageError("vectorization_failed", str(exc)) from exc

        ai_meta = {
            "kind": "generated-image",
            "provider": "fake" if self.config.fake else "openai",
            "model": output.model,
            "apiMode": self.config.api_mode,
            "variantId": variant_id,
            "parentVariantId": base_variant_id,
            "providerResponseId": output.provider_response_id,
            "sourceFilename": filename,
            "sourceMime": mime,
            "stylePrompt": STYLE_PROMPT,
            "stylePromptHash": style_prompt_hash(),
            "userInstructions": instructions.strip(),
            "feedback": feedback.strip(),
            "renderMode": render_mode,
            "detail": detail,
            "created": time.time(),
        }
        self._attach_ai_meta(item["id"], ai_meta)
        item["ai"] = ai_meta

        preview = self.gallery.preview(item["id"], 1)
        quality = assess(preview)

        return {
            "variantId": variant_id,
            "parentVariantId": base_variant_id,
            "galleryItem": item,
            "preview": preview,
            "imageUrl": f"/api/gallery/{item['id']}/original",
            "prompt": {
                "style": STYLE_PROMPT,
                "instructions": instructions.strip(),
                "feedback": feedback.strip(),
            },
            "quality": quality,
        }

    def _validate_input(self, filename: str, data: bytes) -> None:
        max_bytes = self.config.max_input_mb * 1024 * 1024
        if len(data) > max_bytes:
            raise AiImageError(
                "file_too_large", f"Bild zu groß — maximal {self.config.max_input_mb} MB."
            )
        if not data:
            raise AiImageError("unsupported_file", "Leere Datei.")
        try:
            from ..services.upload_validation import sniff_kind

            kind = sniff_kind(filename, data)
        except UnsupportedUpload as exc:
            raise AiImageError("unsupported_file", str(exc)) from exc
        if kind not in ALLOWED_INPUT_KINDS:
            raise AiImageError(
                "unsupported_file", "Als Referenzbild werden nur PNG oder JPG akzeptiert."
            )

    def _attach_ai_meta(self, item_id: str, ai_meta: dict) -> None:
        """Add the ``ai`` provenance block to the gallery item's meta.json,
        leaving every existing field untouched."""
        meta_path = self.gallery.root / item_id / "meta.json"
        meta = json.loads(meta_path.read_text())
        meta["ai"] = ai_meta
        meta_path.write_text(json.dumps(meta, indent=2))
