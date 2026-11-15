from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

from plotter.core.calibration import data_dir
from plotter.core.jsonstore import atomic_write_json

log = logging.getLogger(__name__)

_FILE = "user_settings.json"
_lock = threading.RLock()

# Fields the API must never accept from a PATCH request.
# Computed flags (api_key_configured, enabled) are derived at load time and
# must not be stored; secrets use their plain field name (ai.api_key) instead.
_READONLY = frozenset(
    {
        "ai.enabled",
        "ai.api_key_configured",
        "printer.octoprint_api_key_configured",
        "mcp.token_configured",
        "gallery.upload_secret_configured",
    }
)


def _path() -> Path:
    return data_dir() / _FILE


def load_saved() -> dict:
    """Return persisted user settings as a flat ``"section.field"`` dict."""
    with _lock:
        p = _path()
        try:
            data = json.loads(p.read_text())
            return data if isinstance(data, dict) else {}
        except FileNotFoundError:
            return {}
        except (ValueError, OSError):
            log.warning("Could not read %s — using empty saved settings", p)
            return {}


def _write(saved: dict) -> None:
    atomic_write_json(_path(), saved)


def patch_saved(updates: dict) -> dict:
    """Merge *updates* into the persisted settings and return the full saved dict.

    Unknown keys are stored as-is so future settings fields are not lost.
    Read-only fields (computed flags, «enabled» derivatives) are silently
    skipped — the caller must not be able to forge them.
    """
    filtered = {k: v for k, v in updates.items() if k not in _READONLY}
    with _lock:
        saved = load_saved()
        saved.update(filtered)
        _write(saved)
        return saved


def clear_field(section: str, field: str) -> dict:
    """Remove a single persisted override so it falls back to env / default."""
    key = f"{section}.{field}"
    with _lock:
        saved = load_saved()
        saved.pop(key, None)
        _write(saved)
        return saved


def reset_all() -> None:
    """Delete the entire settings file (all overrides removed)."""
    with _lock:
        _path().unlink(missing_ok=True)


def load_active_backend() -> str | None:
    """Read the legacy selection file without involving a printer driver."""
    with _lock:
        try:
            payload = json.loads((data_dir() / "printer_backend.json").read_text())
            active = payload.get("active") if isinstance(payload, dict) else None
            return active if isinstance(active, str) else None
        except (ValueError, OSError):
            return None


def save_active_backend(backend_id: str) -> None:
    with _lock:
        try:
            atomic_write_json(data_dir() / "printer_backend.json", {"active": backend_id})
        except OSError as exc:
            log.warning("could not persist active backend: %s", exc)
