"""Application boundary between persisted configuration and live printer drivers."""

from __future__ import annotations

import os
import threading
from collections.abc import Callable

from plotter.core.config import PrinterSettings, load_settings
from plotter.core.position import get_tracker
from plotter.printer.factory import build_backends, resolve_initial_active
from plotter.printer.manager import PrinterManager

from .printer_connections import connection_snapshot
from .settings_store import load_active_backend, load_saved, save_active_backend


def printer_settings() -> PrinterSettings:
    """Resolve one complete snapshot before touching any live connection."""
    return load_settings(load_saved()).printer


class PrinterRuntime:
    """Keep one manager, deferring changes that would replace an active job.

    Drivers receive values only. The manager owns safe connection transitions;
    this service owns configuration, persisted selection and position callbacks.
    """

    def __init__(self, settings: Callable[[], PrinterSettings] = printer_settings):
        self._settings = settings
        self._lock = threading.Lock()
        self._manager: PrinterManager | None = None
        self._applied: PrinterSettings | None = None
        self._connections: list[dict] = []

    def get(self) -> PrinterManager:
        with self._lock:
            cfg = self._settings()
            connections = connection_snapshot(cfg)
            if (
                self._manager is not None
                and cfg == self._applied
                and connections == self._connections
            ):
                return self._manager
            backends = build_backends(cfg, previous=self._applied, manager=self._manager)
            from plotter.printer.octoprint import OctoPrintClient
            from plotter.printer.serial import SerialClient

            metadata = {}
            for item in connections:
                bid = item["id"]
                transport = item["transport"]
                metadata[bid] = {"name": item["name"], "transport": transport}
                if transport == "serial":
                    metadata[bid]["port"] = item["serial_port"]
                if bid in {"serial", "octoprint"}:
                    continue
                old = next((entry for entry in self._connections if entry["id"] == bid), None)
                # Renaming is metadata only; keep the connection and running job.
                same = old is not None and {k: v for k, v in old.items() if k != "name"} == {
                    k: v for k, v in item.items() if k != "name"
                }
                client = self._manager.backend(bid) if self._manager and same else None
                if client is None:
                    if transport == "serial":
                        client = SerialClient(port=item["serial_port"], baud=item["serial_baud"])
                    else:
                        client = OctoPrintClient(
                            item["octoprint_url"],
                            item["octoprint_api_key"],
                            verify_ssl=item["octoprint_verify_ssl"],
                        )
                backends[bid] = client
            active = resolve_initial_active(
                backends,
                cfg,
                saved=load_active_backend(),
                legacy_serial=os.environ.get("PRINTER_USE_SERIAL", "").strip().lower()
                in {"1", "true", "yes", "on"},
            )
            if not backends[active].configured:
                active = next(
                    (bid for bid, backend in backends.items() if backend.configured), active
                )
            if self._manager is None:
                self._manager = PrinterManager(
                    backends,
                    active,
                    on_selection=save_active_backend,
                    on_connection_changed=lambda: get_tracker().invalidate(),
                    metadata=metadata,
                )
                self._applied = cfg
                self._connections = connections
            else:
                # Preserve an explicit current selection when adding/editing a
                # connection, unless it was unconfigured or the default changed.
                preserve = (
                    self._applied is not None
                    and cfg.default_backend == self._applied.default_backend
                )
                if self._manager.reconfigure(
                    backends, active, preserve_selection=preserve, metadata=metadata
                ):
                    self._applied = cfg
                    self._connections = connections
            return self._manager

    def close(self) -> None:
        with self._lock:
            if self._manager is not None:
                self._manager.close()
            self._manager = None
            self._applied = None
            self._connections = []


_runtime = PrinterRuntime()


def get_printer_client() -> PrinterManager:
    return _runtime.get()


def reset_manager() -> None:
    """Release resources on shutdown or before loading a new application state."""
    _runtime.close()


def check_octoprint() -> dict:
    """Test saved credentials independently of a running/deferred connection."""
    from plotter.printer.octoprint import OctoPrintClient, OctoPrintError

    cfg = printer_settings()
    client = OctoPrintClient(
        cfg.octoprint_url, cfg.octoprint_api_key, verify_ssl=cfg.octoprint_verify_ssl
    )
    try:
        if not client.configured:
            return {
                "ok": False,
                "error": "OctoPrint nicht konfiguriert (URL oder API-Schlüssel fehlt).",
            }
        data = client.version()
        return {"ok": True, "version": data.get("server", "?"), "api": data.get("api", "?")}
    except OctoPrintError as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        client.close()
