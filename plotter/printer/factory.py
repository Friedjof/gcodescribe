from __future__ import annotations

import os
import threading

from plotter.core.config import PrinterSettings, load_settings

from .base import PrinterBackend
from .manager import OCTOPRINT, SERIAL, PrinterManager, load_active


def _settings() -> PrinterSettings:
    from plotter.services.settings_store import load_saved

    return load_settings(load_saved()).printer


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def use_serial() -> bool:
    """Back-compat flag: whether serial is enabled."""
    return serial_enabled()


def serial_enabled() -> bool:
    return _settings().serial_enabled


def octoprint_configured() -> bool:
    cfg = _settings()
    return bool(cfg.octoprint_url and cfg.octoprint_api_key)


_manager_lock = threading.Lock()
_manager: PrinterManager | None = None
_manager_settings: PrinterSettings | None = None


def _serial_config(cfg: PrinterSettings) -> tuple:
    return cfg.serial_enabled, cfg.serial_port, cfg.serial_baud


def get_printer_client() -> PrinterBackend:
    """Keep connection settings current, deferring serial changes during a job."""
    global _manager, _manager_settings
    with _manager_lock:
        cfg = _settings()
        if _manager is None:
            _manager = _build_manager(cfg)
            _manager_settings = cfg
        elif (
            _manager_settings is not None
            and (_serial_config(cfg), cfg.default_backend)
            != (_serial_config(_manager_settings), _manager_settings.default_backend)
            and not _manager._job_active()
        ):
            previous = _manager
            serial_changed = _serial_config(cfg) != _serial_config(_manager_settings)
            if serial_changed:
                previous._release_serial()
            # Retain an explicit current selection while adding/editing an idle
            # connection. If it was unconfigured, choose an available backend.
            preferred = previous.active_id if previous.active().configured else None
            if cfg.default_backend != _manager_settings.default_backend:
                preferred = None
            _manager = _build_manager(cfg, preferred=preferred)
            _manager_settings = cfg
            switched = previous.active_id != _manager.active_id
            if switched and previous.active_id == SERIAL and not serial_changed:
                previous._release_serial()
            if switched or (serial_changed and previous.active_id == SERIAL):
                previous._invalidate_position()
        return _manager


def reset_manager() -> None:
    """Drop the cached manager (used by tests after changing settings)."""
    global _manager, _manager_settings
    with _manager_lock:
        _manager = None
        _manager_settings = None


def _build_manager(
    cfg: PrinterSettings | None = None,
    *,
    preferred: str | None = None,
) -> PrinterManager:
    from .octoprint import OctoPrintClient

    cfg = cfg or _settings()
    backends: dict[str, PrinterBackend] = {OCTOPRINT: OctoPrintClient()}
    if cfg.serial_enabled:
        from .serial import SerialClient

        backends[SERIAL] = SerialClient(port=cfg.serial_port, baud=cfg.serial_baud)
    active = preferred if preferred in backends else _resolve_initial_active(backends, cfg)
    return PrinterManager(backends, active)


def _resolve_initial_active(
    backends: dict[str, PrinterBackend],
    cfg: PrinterSettings | None = None,
) -> str:
    # Priority: explicit selection -> effective default -> legacy flag -> configured backend.
    saved = load_active()
    if saved in backends:
        return saved
    cfg = cfg or _settings()
    if cfg.default_backend in backends:
        return cfg.default_backend
    if _truthy(os.environ.get("PRINTER_USE_SERIAL")) and SERIAL in backends:
        return SERIAL
    for pref in (OCTOPRINT, SERIAL):
        if pref in backends and backends[pref].configured:
            return pref
    return next(iter(backends), OCTOPRINT)
