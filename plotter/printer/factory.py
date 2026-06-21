from __future__ import annotations

import os
import threading

from .base import PrinterBackend
from .manager import (
    OCTOPRINT,
    SERIAL,
    PrinterManager,
    load_active,
)


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def use_serial() -> bool:
    """Back-compat flag: whether serial is involved at all (enabled or default)."""
    return serial_enabled()


def serial_enabled() -> bool:
    return _truthy(os.environ.get("PRINTER_SERIAL_ENABLED")) or _truthy(
        os.environ.get("PRINTER_USE_SERIAL")
    )


def octoprint_configured() -> bool:
    return bool(os.environ.get("OCTOPRINT_URL") and os.environ.get("OCTOPRINT_API_KEY"))


_manager_lock = threading.Lock()
_manager: PrinterManager | None = None


def get_printer_client() -> PrinterBackend:
    """Return the process-wide :class:`PrinterManager` (holds all backends)."""
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = _build_manager()
        return _manager


def reset_manager() -> None:
    """Drop the cached manager (used by tests after changing the environment)."""
    global _manager
    with _manager_lock:
        _manager = None


def _build_manager() -> PrinterManager:
    from .octoprint import OctoPrintClient

    # OctoPrint is always present (it self-reports configured=false when its env
    # is unset), so the legacy single-backend behaviour is preserved. Serial is
    # only added when explicitly enabled.
    backends: dict[str, PrinterBackend] = {OCTOPRINT: OctoPrintClient()}
    if serial_enabled():
        from .serial import SerialClient

        backends[SERIAL] = SerialClient()
    return PrinterManager(backends, _resolve_initial_active(backends))


def _resolve_initial_active(backends: dict[str, PrinterBackend]) -> str:
    # Priority: persisted choice -> env default -> back-compat -> first available.
    saved = load_active()
    if saved in backends:
        return saved
    env_default = os.environ.get("PRINTER_DEFAULT_BACKEND")
    if env_default in backends:
        return env_default
    if _truthy(os.environ.get("PRINTER_USE_SERIAL")) and SERIAL in backends:
        return SERIAL
    for pref in (OCTOPRINT, SERIAL):
        if pref in backends:
            return pref
    # No backend configured at all — the manager reports unconfigured.
    return OCTOPRINT
