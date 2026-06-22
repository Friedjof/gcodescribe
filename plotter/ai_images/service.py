from __future__ import annotations

import json
import time
import uuid

from ..pipeline import PlotterError
from ..services.errors import ServiceError
from ..services.gallery import GalleryService
from ..services.upload_validation import UnsupportedUpload, UploadTooLarge
from .client import AiImageRequest, make_client
from .config import ALLOWED_RENDER_MODES, DEFAULT_RENDER_MODE, AiImageConfig
from .errors import AiImageError
from .prompts import compose_prompt, style_prompt_for, style_prompt_hash
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
        filename: str = "",
        data: bytes | None = None,
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

        # Pick the reference image: an explicit upload wins; otherwise a feedback
        # request iterates on the parent variant's own AI output.
        parent = self._resolve_parent(base_variant_id) if base_variant_id else None
        if base_variant_id and parent is None:
            raise AiImageError("bad_response", "Basis-Variante nicht gefunden.")
        if data:
            self._validate_input(filename, data)
            ref_bytes, ref_name, ref_mime = data, filename, (mime or "image/png")
        elif parent is not None:
            ref_bytes, ref_name, ref_mime = parent["bytes"], parent["filename"], parent["mime"]
        else:
            raise AiImageError(
                "unsupported_file", "Kein Referenzbild — Bild hochladen oder Variante wählen."
            )

        prompt = compose_prompt(instructions, feedback, render_mode)
        client = make_client(self.config)
        output = client.generate_plotter_image(
            AiImageRequest(
                image_bytes=ref_bytes,
                filename=ref_name,
                mime=ref_mime,
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
        item_title = (title or f"AI: {ref_name.rsplit('.', 1)[0]}").strip()
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
            "sourceFilename": ref_name,
            "sourceMime": ref_mime,
            "stylePrompt": style_prompt_for(render_mode),
            "stylePromptHash": style_prompt_hash(render_mode),
            "userInstructions": instructions.strip(),
            "feedback": feedback.strip(),
            "renderMode": render_mode,
            "detail": detail,
            "created": time.time(),
        }
        self._attach_ai_meta(item["id"], ai_meta)
        item["ai"] = ai_meta
        item["status"] = "draft"
        return self._result_for(item)

    def rerender_variant(self, item_id: str, *, render_mode: str, detail: int) -> dict:
        """Re-trace an existing AI variant in a different mode/detail without a
        new generation. Reuses the gallery's in-place rerender, then recomputes
        the plottability assessment from the fresh preview."""
        if not self.config.enabled:
            raise AiImageError("not_configured", "AI Designer ist nicht konfiguriert.")
        render_mode = render_mode if render_mode in ALLOWED_RENDER_MODES else DEFAULT_RENDER_MODE
        detail = max(1, min(int(detail), 3))
        item = self.gallery.get(item_id)
        if not item.get("ai"):
            raise AiImageError("bad_response", "Kein AI-Element.")
        try:
            updated = self.gallery.rerender(item_id, mode=render_mode, detail=detail)
        except (PlotterError, UploadTooLarge) as exc:
            raise AiImageError("vectorization_failed", str(exc)) from exc
        return self._result_for(updated)

    def save_variant(self, item_id: str) -> dict:
        """Promote a draft AI variant to a normal, listed gallery item."""
        if not self.config.enabled:
            raise AiImageError("not_configured", "AI Designer ist nicht konfiguriert.")
        item = self.gallery.get(item_id)
        if not item.get("ai"):
            raise AiImageError("bad_response", "Kein AI-Element.")
        return self._result_for(self.gallery.set_status(item_id, "active"))

    def _result_for(self, item: dict) -> dict:
        """Assemble the AiImageResult from a persisted gallery item carrying an
        ``ai`` block, recomputing preview + quality."""
        ai = item.get("ai") or {}
        preview = self.gallery.preview(item["id"], 1)
        instructions = ai.get("userInstructions", "")
        feedback = ai.get("feedback", "")
        mode = ai.get("renderMode", DEFAULT_RENDER_MODE)
        return {
            "variantId": ai.get("variantId"),
            "parentVariantId": ai.get("parentVariantId"),
            "saved": item.get("status") == "active",
            "galleryItem": item,
            "preview": preview,
            "imageUrl": f"/api/gallery/{item['id']}/original",
            "prompt": {
                "style": ai.get("stylePrompt", style_prompt_for(mode)),
                "instructions": instructions,
                "feedback": feedback,
                # The exact, full prompt string that was sent to the model.
                "text": compose_prompt(instructions, feedback, mode),
            },
            "quality": assess(preview),
        }

    def _resolve_parent(self, base_variant_id: str) -> dict | None:
        """Find the gallery item for a variant id and return its AI output as a
        reference image. Scans meta files directly (Option A, no index file) so
        it also finds unsaved drafts, which the gallery list hides.
        """
        for meta_file in self.gallery.root.glob("*/meta.json"):
            try:
                meta = json.loads(meta_file.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            ai = meta.get("ai") or {}
            if ai.get("variantId") != base_variant_id:
                continue
            item_id = meta.get("id") or meta_file.parent.name
            try:
                path, info = self.gallery.original_path(item_id)
            except ServiceError:
                return None
            return {
                "item": meta,
                "bytes": path.read_bytes(),
                "filename": info.get("filename") or "parent.png",
                "mime": info.get("mime") or "image/png",
            }
        return None

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
        """Add the ``ai`` provenance block to the gallery item's meta.json and
        mark it a ``draft`` — AI results are not shown in the gallery until the
        user explicitly saves them. Every other field is left untouched."""
        meta_path = self.gallery.root / item_id / "meta.json"
        meta = json.loads(meta_path.read_text())
        meta["ai"] = ai_meta
        meta["status"] = "draft"
        meta_path.write_text(json.dumps(meta, indent=2))
