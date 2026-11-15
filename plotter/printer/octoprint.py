from __future__ import annotations

import threading
import time
from pathlib import Path

import httpx

from plotter.core.config import load_settings
from plotter.services.settings_store import load_saved

from .base import PrinterError, require_manual_motion

# A short connect timeout keeps an unreachable/slow printer from tying up a
# request worker for 30s (the old default) — the status loop polls every few
# seconds, so a dead relay must fail fast or it starves the whole threadpool.
_TIMEOUT = httpx.Timeout(connect=3.0, read=8.0, write=8.0, pool=3.0)
_STATUS_TTL = 2.0  # seconds; collapse rapid status polls into one upstream call

# Persistent, connection-pooled client keyed by config. Reusing it keeps the
# TCP+TLS connection alive across requests instead of re-handshaking every call
# (the status snapshot alone made three sequential requests).
_pool_lock = threading.Lock()
_pool: dict[tuple, httpx.Client] = {}

# Cached status snapshot shared across PrinterController instances.
_status_lock = threading.Lock()
_status_cache: dict[tuple, tuple[float, dict]] = {}


class OctoPrintError(PrinterError):
    """OctoPrint-specific failure; a PrinterError so the web layer catches it."""


class OctoPrintClient:
    """Thin wrapper around the OctoPrint REST API."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self._base_url_override = base_url
        self._api_key_override = api_key
        self._refresh_config()

    def _refresh_config(self) -> None:
        # The manager lives for the process lifetime. Re-read effective settings
        # so saving credentials also updates that existing client, without
        # resetting the manager or interrupting a serial worker.
        cfg = load_settings(load_saved()).printer
        url = cfg.octoprint_url if self._base_url_override is None else self._base_url_override
        self.base_url = url.rstrip("/")
        self.api_key = (
            cfg.octoprint_api_key if self._api_key_override is None else self._api_key_override
        )
        self.verify_ssl = cfg.octoprint_verify_ssl

    @property
    def configured(self) -> bool:
        self._refresh_config()
        return bool(self.base_url and self.api_key)

    def _key(self) -> tuple:
        return (self.base_url, self.api_key, self.verify_ssl)

    def _client(self) -> httpx.Client:
        if not self.configured:
            raise OctoPrintError(
                "OctoPrint is not configured (save a URL and API key in settings)."
            )
        key = self._key()
        with _pool_lock:
            client = _pool.get(key)
            if client is None:
                client = httpx.Client(
                    base_url=self.base_url,
                    headers={"X-Api-Key": self.api_key},
                    timeout=_TIMEOUT,
                    verify=self.verify_ssl,
                )
                _pool[key] = client
            return client

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            resp = self._client().request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise OctoPrintError(f"OctoPrint unreachable: {exc}") from exc
        if resp.status_code >= 400:
            raise OctoPrintError(
                f"OctoPrint {method} {path} failed ({resp.status_code}): {resp.text[:200]}"
            )
        return resp

    # --- status ----------------------------------------------------------

    def status(self) -> dict:
        """Combined connection / printer / job snapshot for the UI.

        Cached for a couple of seconds: the UI polls this every few seconds and
        several views read it at once, so without the cache a slow printer would
        be hit by a storm of redundant (and threadpool-blocking) requests.
        """
        if not self.configured:
            return {"configured": False, "backend": "octoprint"}
        key = self._key()
        now = time.monotonic()
        with _status_lock:
            cached = _status_cache.get(key)
            if cached and now - cached[0] < _STATUS_TTL:
                return cached[1]
        snapshot = self._fetch_status()
        with _status_lock:
            _status_cache[key] = (time.monotonic(), snapshot)
        return snapshot

    def _fetch_status(self) -> dict:
        out: dict = {"configured": True, "backend": "octoprint", "url": self.base_url}
        try:
            conn = self._request("GET", "/api/connection").json()
            out["connection"] = conn.get("current", {})
        except OctoPrintError as exc:
            out["error"] = str(exc)
            out["online"] = False
            return out
        out["online"] = True
        try:
            out["printer"] = self._request("GET", "/api/printer").json()
        except OctoPrintError:
            out["printer"] = None  # printer offline / not operational
        try:
            out["job"] = self._request("GET", "/api/job").json()
        except OctoPrintError:
            out["job"] = None
        return out

    # --- files / printing ------------------------------------------------

    def upload(self, gcode_path: Path, *, start: bool = False) -> dict:
        with gcode_path.open("rb") as fh:
            files = {"file": (gcode_path.name, fh, "text/x.gcode")}
            data = {"select": "true", "print": "true" if start else "false"}
            resp = self._request("POST", "/api/files/local", files=files, data=data)
        return resp.json()

    def select_and_print(self, filename: str, *, start: bool = True) -> None:
        self._request(
            "POST",
            f"/api/files/local/{filename}",
            json={"command": "select", "print": start},
        )

    def job_command(self, command: str) -> None:
        """command: start | pause | resume | cancel | restart."""
        body: dict = {"command": command}
        if command in ("pause", "resume"):
            body = {"command": "pause", "action": command}
        self._request("POST", "/api/job", json=body)

    # --- printer control -------------------------------------------------

    def _require_manual_motion(self) -> None:
        # Never use the UI status cache for a motion decision: a print may
        # have started since the last poll, including through OctoPrint itself.
        job = self._request("GET", "/api/job").json()
        require_manual_motion(job.get("state"))

    def home(self, axes: list[str] | None = None) -> None:
        self._require_manual_motion()
        self._request(
            "POST",
            "/api/printer/printhead",
            json={"command": "home", "axes": axes or ["x", "y", "z"]},
        )

    def jog(self, x: float = 0.0, y: float = 0.0, z: float = 0.0, speed: int | None = None) -> None:
        self._require_manual_motion()
        body: dict = {"command": "jog", "x": x, "y": y, "z": z}
        if speed is not None:
            body["speed"] = speed
        self._request("POST", "/api/printer/printhead", json=body)

    def gcode(self, commands: list[str]) -> None:
        self._require_manual_motion()
        self._request("POST", "/api/printer/command", json={"commands": commands})
