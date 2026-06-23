from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...config import load_settings_with_sources
from ...services.settings_store import clear_field, load_saved, patch_saved

router = APIRouter(tags=["settings"])


def _effective() -> dict:
    settings, sources = load_settings_with_sources(saved=load_saved())
    return {**settings.redact(), "sources": sources}


@router.get("/settings")
def get_settings() -> dict:
    """Return the effective application settings with secrets redacted."""
    settings, _ = load_settings_with_sources(saved=load_saved())
    return settings.redact()


@router.get("/settings/effective")
def get_effective_settings() -> dict:
    """Return the effective settings together with the per-field source map.

    Sources: ``"default"`` | ``"environment"`` | ``"saved"``.
    Secrets are never included — only presence flags are returned.
    """
    return _effective()


class SettingsPatch(BaseModel):
    settings: dict


@router.patch("/settings")
def patch_settings(body: SettingsPatch) -> dict:
    """Persist user-supplied overrides and return the updated effective config.

    Keys must be ``"section.field"`` strings.  Computed flags
    (``ai.enabled``, ``*_configured``) are silently ignored.
    Secrets (``ai.api_key``, ``printer.octoprint_api_key``) are accepted but
    never returned in the response.
    """
    if not isinstance(body.settings, dict):
        raise HTTPException(status_code=422, detail="settings must be a dict")
    for key in body.settings:
        if not isinstance(key, str) or "." not in key:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid settings key {key!r} — expected 'section.field'",
            )
    patch_saved(body.settings)
    return _effective()


@router.delete("/settings/{section}/{field}")
def reset_setting(section: str, field: str) -> dict:
    """Remove a single persisted override, falling back to env / default."""
    clear_field(section, field)
    return _effective()
