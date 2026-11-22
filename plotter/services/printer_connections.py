"""Named physical printers, alongside the original environment/settings connection."""

from __future__ import annotations

import os
import threading
import uuid
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from plotter.core.config import PrinterSettings

from .settings_store import load_saved, patch_saved

_lock = threading.RLock()


class ConnectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    transport: Literal["serial", "octoprint"]
    serial_port: str = ""
    serial_baud: int = Field(default=115200, ge=1200, le=2000000)
    octoprint_url: str = ""
    octoprint_api_key: str | None = None  # omitted/blank on edits keeps the saved key
    octoprint_verify_ssl: bool = True

    @field_validator("name", "serial_port", "octoprint_url")
    @classmethod
    def trim(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_connection(self) -> ConnectionInput:
        if not self.name:
            raise ValueError("Bitte einen Druckernamen eingeben.")
        if self.transport == "serial" and not self.serial_port:
            raise ValueError("Bitte einen seriellen Anschluss auswählen oder eingeben.")
        if self.transport == "octoprint":
            url = urlsplit(self.octoprint_url)
            if (
                url.scheme not in {"http", "https"}
                or not url.hostname
                or url.username
                or url.password
            ):
                raise ValueError("Bitte eine HTTP(S)-URL ohne Zugangsdaten eingeben.")
        return self


def connection_snapshot(cfg: PrinterSettings) -> list[dict]:
    """Private snapshot; raw secrets never leave the service/runtime boundary."""
    saved = load_saved()
    names = saved.get("printer.names", {})
    if not isinstance(names, dict):
        names = {}
    result = []
    if cfg.octoprint_url or cfg.octoprint_api_key:
        result.append(
            {
                "id": "octoprint",
                "name": names.get("octoprint", "OctoPrint"),
                "transport": "octoprint",
                "octoprint_url": cfg.octoprint_url,
                "octoprint_api_key": cfg.octoprint_api_key,
                "octoprint_verify_ssl": cfg.octoprint_verify_ssl,
            }
        )
    if cfg.serial_enabled:
        result.append(
            {
                "id": "serial",
                "name": names.get("serial", "USB / Serial"),
                "transport": "serial",
                "serial_port": cfg.serial_port,
                "serial_baud": cfg.serial_baud,
            }
        )
    extras = saved.get("printer.connections", [])
    seen = {"serial", "octoprint"}
    for item in extras if isinstance(extras, list) else []:
        if not isinstance(item, dict):
            continue
        bid = item.get("id")
        if not isinstance(bid, str) or not bid.startswith("printer-") or bid in seen:
            continue
        try:
            value = ConnectionInput.model_validate({k: v for k, v in item.items() if k != "id"})
        except ValueError:
            continue
        seen.add(bid)
        result.append({**value.model_dump(), "id": bid})
    return result


def public_connection(item: dict) -> dict:
    return {
        **{key: value for key, value in item.items() if key != "octoprint_api_key"},
        "octoprint_api_key_configured": bool(item.get("octoprint_api_key")),
    }


def save_connection(
    data: ConnectionInput, cfg: PrinterSettings, printer_id: str | None = None
) -> dict:
    with _lock:
        entries = connection_snapshot(cfg)
        old = next((item for item in entries if item["id"] == printer_id), None)
        if printer_id is not None and old is None:
            raise KeyError(printer_id)
        if old and old["transport"] != data.transport:
            raise ValueError("Zum Ändern der Anschlussart bitte einen neuen Drucker hinzufügen.")
        entry = data.model_dump()
        entry["id"] = printer_id or "printer-" + uuid.uuid4().hex[:12]
        entry["octoprint_api_key"] = data.octoprint_api_key or (old or {}).get(
            "octoprint_api_key", ""
        )
        if data.transport == "octoprint" and not entry["octoprint_api_key"]:
            raise ValueError("Bitte den OctoPrint-API-Schlüssel eingeben.")
        for other in entries:
            if other["id"] == printer_id or other["transport"] != data.transport:
                continue
            if data.transport == "serial":
                duplicate = os.path.realpath(other["serial_port"]) == os.path.realpath(
                    data.serial_port
                )
            else:
                duplicate = (
                    other["octoprint_url"].rstrip("/").lower()
                    == data.octoprint_url.rstrip("/").lower()
                )
            if duplicate:
                raise ValueError("Dieser Anschluss ist bereits einem Drucker zugeordnet.")
        saved = load_saved()
        if printer_id in {"serial", "octoprint"}:
            names = saved.get("printer.names", {})
            names = {**(names if isinstance(names, dict) else {}), printer_id: data.name}
            fields = (
                ("serial_port", "serial_baud")
                if data.transport == "serial"
                else ("octoprint_url", "octoprint_api_key", "octoprint_verify_ssl")
            )
            patch_saved(
                {"printer.names": names, **{"printer." + key: entry[key] for key in fields}}
            )
        else:
            extras = [item for item in entries if item["id"] not in {"serial", "octoprint"}]
            if printer_id is None:
                extras.append(entry)
            else:
                extras = [entry if item["id"] == printer_id else item for item in extras]
            patch_saved({"printer.connections": extras})
        return public_connection(entry)


def delete_connection(printer_id: str, cfg: PrinterSettings) -> None:
    with _lock:
        if not any(item["id"] == printer_id for item in connection_snapshot(cfg)):
            raise KeyError(printer_id)
        if printer_id == "serial":
            patch_saved({"printer.serial_enabled": False})
        elif printer_id == "octoprint":
            patch_saved({"printer.octoprint_url": "", "printer.octoprint_api_key": ""})
        else:
            extras = [
                item
                for item in connection_snapshot(cfg)
                if item["id"] not in {"serial", "octoprint"}
            ]
            patch_saved(
                {"printer.connections": [item for item in extras if item["id"] != printer_id]}
            )
