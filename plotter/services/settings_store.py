from __future__ import annotations

import json
import logging
from pathlib import Path

from ..calibration import data_dir

log = logging.getLogger(__name__)

_FILE = "user_settings.json"

# Fields the API must never accept from a PATCH request.
# Computed flags (api_key_configured, enabled) are derived at load time and
# must not be stored; secrets use their plain field name (ai.api_key) instead.
_READONLY = frozenset(
    {
        "ai.enabled",
        "ai.api_key_configured",
        "printer.octoprint_api_key_configured",
        "mcp.token_configured",
    }
)


def _path() -> Path:
    return data_dir() / _FILE


def load_saved() -> dict:
    """Return persisted user settings as a flat ``"section.field"`` dict."""
    p = _path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        log.warning("Could not read %s — using empty saved settings", p)
        return {}


def _write(saved: dict) -> None:
    _path().write_text(json.dumps(saved, indent=2, ensure_ascii=False))


def patch_saved(updates: dict) -> dict:
    """Merge *updates* into the persisted settings and return the full saved dict.

    Unknown keys are stored as-is so future settings fields are not lost.
    Read-only fields (computed flags, «enabled» derivatives) are silently
    skipped — the caller must not be able to forge them.
    """
    filtered = {k: v for k, v in updates.items() if k not in _READONLY}
    saved = load_saved()
    saved.update(filtered)
    _write(saved)
    return saved


def clear_field(section: str, field: str) -> dict:
    """Remove a single persisted override so it falls back to env / default."""
    key = f"{section}.{field}"
    saved = load_saved()
    saved.pop(key, None)
    _write(saved)
    return saved


def reset_all() -> None:
    """Delete the entire settings file (all overrides removed)."""
    p = _path()
    if p.exists():
        p.unlink()
