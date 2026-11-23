"""Explicit diagnostics for one saved printer; never changes the selected printer."""

from __future__ import annotations

import os
from pathlib import Path

import httpx

from .printer_connections import connection_snapshot
from .printer_runtime import get_printer_client, printer_settings


def check_connection(printer_id: str, *, probe: bool = False) -> dict:
    entry = next(
        (p for p in connection_snapshot(printer_settings()) if p["id"] == printer_id), None
    )
    if entry is None:
        raise KeyError(printer_id)
    steps = []

    def add(key, outcome, message, code, **variables):
        steps.append(
            {
                "key": key,
                "state": outcome,
                "message": message,
                "messageKey": f"printers.check.{code}",
                "variables": variables,
            }
        )

    result = {"id": printer_id, "steps": steps, "canProbe": False}
    if entry["transport"] == "octoprint":
        from plotter.printer.octoprint import OctoPrintClient

        client = OctoPrintClient(
            entry["octoprint_url"],
            entry.get("octoprint_api_key") or "",
            verify_ssl=entry["octoprint_verify_ssl"],
        )
        try:
            response = client._client().get("/api/version")
            add("server", "ok", "OctoPrint antwortet.", "serverOnline")
            if response.status_code in (401, 403):
                add("access", "failed", "API-Schlüssel oder Berechtigung prüfen.", "accessDenied")
            elif response.status_code >= 400:
                add(
                    "access",
                    "failed",
                    f"OctoPrint meldet HTTP {response.status_code}.",
                    "httpError",
                    status=response.status_code,
                )
            else:
                connection = client._client().get("/api/connection")
                if connection.status_code in (401, 403):
                    add(
                        "access",
                        "failed",
                        "API-Schlüssel oder Berechtigung prüfen.",
                        "accessDenied",
                    )
                    result["ok"] = False
                    return result
                connection.raise_for_status()
                add("access", "ok", "API-Zugang bestätigt.", "accessOK")
                current = connection.json().get("current") or {}
                state = str(current.get("state") or "Unbekannt")
                connected = state.lower() in (
                    "operational",
                    "printing",
                    "paused",
                    "pausing",
                    "resuming",
                )
                add(
                    "device",
                    "ok" if connected else "failed",
                    f"Druckerverbindung: {state}",
                    "deviceState",
                    state=state,
                )
        except (httpx.HTTPError, ValueError, RuntimeError):
            add(
                "server" if not steps else "device",
                "failed",
                "Verbindung fehlgeschlagen. Adresse, Netzwerk und Berechtigungen prüfen.",
                "connectionFailed",
            )
        finally:
            client.close()
    else:
        from plotter.printer import discovery
        from plotter.printer.serial import peek_worker

        manager = get_printer_client()
        # Keep a concurrent selection/edit from closing the driver under this test.
        with manager._transition():
            backend = manager.backend(printer_id)
            status = backend.status() if backend else {}
            port = entry["serial_port"]
            if port == "auto":
                port = discovery.resolve_auto_port() or ""
            present = bool(port and Path(port).exists())
            add(
                "port",
                "ok" if present else "failed",
                "Anschluss gefunden." if present else "Anschluss nicht gefunden.",
                "portFound" if present else "portMissing",
            )
            if status.get("online"):
                add(
                    "device",
                    "ok",
                    "Firmware ist über die bestehende Verbindung erreichbar.",
                    "firmwareConnected",
                )
            elif not present:
                add(
                    "device",
                    "skipped",
                    "Firmware kann ohne Anschluss nicht geprüft werden.",
                    "noPortFirmware",
                )
            elif manager._backend_busy(manager.active()) or peek_worker() is not None:
                add(
                    "device",
                    "busy",
                    "Anschlussprüfung zurückgestellt: Druckerverbindung ist in Benutzung.",
                    "portBusy",
                )
            elif not os.access(port, os.R_OK | os.W_OK):
                add(
                    "device",
                    "failed",
                    "Kein Lese-/Schreibzugriff auf den Anschluss.",
                    "portPermission",
                )
            elif probe:
                response = discovery.probe(port, baud=entry["serial_baud"])
                add(
                    "device",
                    "ok" if response.get("marlin") else "failed",
                    str(
                        response.get("firmware")
                        or response.get("error")
                        or "Keine Firmware-Antwort."
                    ),
                    "firmwareResponse",
                    response=str(response.get("firmware") or response.get("error") or "—"),
                )
            else:
                result["canProbe"] = True
                add("device", "skipped", "Firmware-Antwort noch nicht geprüft.", "notProbed")
    result["ok"] = bool(steps) and all(s["state"] == "ok" for s in steps)
    return result
