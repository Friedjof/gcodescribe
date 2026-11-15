from __future__ import annotations

import threading
import time
from pathlib import Path

import httpx

from .base import PrinterError, require_manual_motion
from .types import PrinterJob, PrinterStatus

# A short connect timeout keeps an unreachable/slow printer from tying up a
# request worker for 30s (the old default) — the status loop polls every few
# seconds, so a dead relay must fail fast or it starves the whole threadpool.
_TIMEOUT = httpx.Timeout(connect=3.0, read=8.0, write=8.0, pool=3.0)
_STATUS_TTL = 2.0  # seconds; collapse rapid status polls into one upstream call


class OctoPrintError(PrinterError):
    """OctoPrint-specific failure; a PrinterError so the web layer catches it."""


class OctoPrintClient:
    """Thin wrapper around the OctoPrint REST API."""

    def __init__(self, base_url: str = "", api_key: str = "", *, verify_ssl: bool = True):
        # The application supplies one connection snapshot. Reading properties
        # or sending consecutive requests must never reload/change credentials.
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.verify_ssl = verify_ssl
        self._lock = threading.Lock()
        self._http: httpx.Client | None = None
        self._status_cache: tuple[float, PrinterStatus] | None = None
        self._last_known_job: PrinterJob | None = None

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _client(self) -> httpx.Client:
        if not self.configured:
            raise OctoPrintError(
                "OctoPrint is not configured (save a URL and API key in settings)."
            )
        with self._lock:
            if self._http is None:
                self._http = httpx.Client(
                    base_url=self.base_url,
                    headers={"X-Api-Key": self.api_key},
                    timeout=_TIMEOUT,
                    verify=self.verify_ssl,
                )
            return self._http

    def close(self) -> None:
        """Release the connection pool when replaced or on app shutdown."""
        with self._lock:
            client, self._http = self._http, None
            self._status_cache = None
        if client is not None:
            client.close()

    def version(self) -> dict:
        return self._request("GET", "/api/version").json()

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

    def status(self, *, fresh: bool = False) -> PrinterStatus:
        """Combined connection / printer / job snapshot for the UI.

        Cached for a couple of seconds: the UI polls this every few seconds and
        several views read it at once, so without the cache a slow printer would
        be hit by a storm of redundant (and threadpool-blocking) requests.
        """
        if not self.configured:
            return {"configured": False, "backend": "octoprint"}
        now = time.monotonic()
        with self._lock:
            cached = self._status_cache
            if not fresh and cached and now - cached[0] < _STATUS_TTL:
                return cached[1]
        snapshot = self._fetch_status()
        with self._lock:
            self._status_cache = (time.monotonic(), snapshot)
        return snapshot

    def reconfiguration_status(self) -> PrinterStatus:
        """Refresh the job guard; retain a known job across connection failures.

        An unreachable, previously idle/unconfigured connection must still be
        editable. Losing connectivity during a known plot must not unlock it.
        """
        status = self.status(fresh=True)
        if status.get("job") is None and self._last_known_job is not None:
            return {**status, "job": self._last_known_job}
        return status

    def _fetch_status(self) -> PrinterStatus:
        out: PrinterStatus = {"configured": True, "backend": "octoprint", "url": self.base_url}
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
            self._last_known_job = out["job"]
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
