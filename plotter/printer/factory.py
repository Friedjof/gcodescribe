"""Construct drivers from explicit settings; application lifetime lives in services."""

from __future__ import annotations

from plotter.core.config import PrinterSettings

from .base import PrinterBackend
from .manager import OCTOPRINT, SERIAL, PrinterManager


def build_backends(
    cfg: PrinterSettings,
    *,
    previous: PrinterSettings | None = None,
    manager: PrinterManager | None = None,
) -> dict[str, PrinterBackend]:
    """Reuse unchanged clients so an unrelated edit never resets a connection."""
    from .octoprint import OctoPrintClient
    from .serial import SerialClient

    octo = manager.backend(OCTOPRINT) if manager else None
    if (
        octo is None
        or previous is None
        or (cfg.octoprint_url, cfg.octoprint_api_key, cfg.octoprint_verify_ssl)
        != (previous.octoprint_url, previous.octoprint_api_key, previous.octoprint_verify_ssl)
    ):
        octo = OctoPrintClient(
            cfg.octoprint_url, cfg.octoprint_api_key, verify_ssl=cfg.octoprint_verify_ssl
        )
    backends: dict[str, PrinterBackend] = {OCTOPRINT: octo}
    if cfg.serial_enabled:
        serial = manager.backend(SERIAL) if manager else None
        if (
            serial is None
            or previous is None
            or (cfg.serial_port, cfg.serial_baud) != (previous.serial_port, previous.serial_baud)
        ):
            serial = SerialClient(port=cfg.serial_port, baud=cfg.serial_baud)
        backends[SERIAL] = serial
    return backends


def resolve_initial_active(
    backends: dict[str, PrinterBackend],
    cfg: PrinterSettings,
    *,
    saved: str | None = None,
    legacy_serial: bool = False,
) -> str:
    """Selection priority, with all persistence/environment values supplied."""
    if saved in backends:
        return saved
    if cfg.default_backend in backends:
        return cfg.default_backend
    if legacy_serial and SERIAL in backends:
        return SERIAL
    for pref in (OCTOPRINT, SERIAL):
        if pref in backends and backends[pref].configured:
            return pref
    return next(iter(backends), OCTOPRINT)


# Compatibility entry points used by controllers, MCP and the web app. Imports
# stay lazy so low-level printer modules do not depend on application services.
def get_printer_client() -> PrinterManager:
    from plotter.services.printer_runtime import get_printer_client as get

    return get()


def reset_manager() -> None:
    from plotter.services.printer_runtime import reset_manager as reset

    reset()


def serial_enabled() -> bool:
    from plotter.services.printer_runtime import printer_settings

    return printer_settings().serial_enabled


def use_serial() -> bool:
    return serial_enabled()


def octoprint_configured() -> bool:
    from plotter.services.printer_runtime import printer_settings

    cfg = printer_settings()
    return bool(cfg.octoprint_url and cfg.octoprint_api_key)
