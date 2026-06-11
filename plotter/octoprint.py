from __future__ import annotations

import os
from pathlib import Path

import httpx


class OctoPrintError(RuntimeError):
    pass


class OctoPrintClient:
    """Thin wrapper around the OctoPrint REST API."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = (base_url or os.environ.get("OCTOPRINT_URL", "")).rstrip("/")
        self.api_key = api_key or os.environ.get("OCTOPRINT_API_KEY", "")
        # Set OCTOPRINT_VERIFY_SSL=false to skip cert verification (self-signed / internal CA).
        verify_env = os.environ.get("OCTOPRINT_VERIFY_SSL", "true").lower()
        self.verify_ssl: bool | str = verify_env not in ("false", "0", "no")

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _client(self) -> httpx.Client:
        if not self.configured:
            raise OctoPrintError(
                "OctoPrint is not configured (set OCTOPRINT_URL and OCTOPRINT_API_KEY)."
            )
        return httpx.Client(
            base_url=self.base_url,
            headers={"X-Api-Key": self.api_key},
            timeout=30.0,
            verify=self.verify_ssl,
        )

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            with self._client() as client:
                resp = client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise OctoPrintError(f"OctoPrint unreachable: {exc}") from exc
        if resp.status_code >= 400:
            raise OctoPrintError(
                f"OctoPrint {method} {path} failed ({resp.status_code}): {resp.text[:200]}"
            )
        return resp

    # --- status ----------------------------------------------------------

    def status(self) -> dict:
        """Combined connection / printer / job snapshot for the UI."""
        if not self.configured:
            return {"configured": False}
        out: dict = {"configured": True, "url": self.base_url}
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
        """command: start | pause | cancel | restart."""
        body: dict = {"command": command}
        if command == "pause":
            body["action"] = "pause"
        self._request("POST", "/api/job", json=body)

    # --- printer control -------------------------------------------------

    def home(self, axes: list[str] | None = None) -> None:
        self._request(
            "POST",
            "/api/printer/printhead",
            json={"command": "home", "axes": axes or ["x", "y", "z"]},
        )

    def jog(self, x: float = 0.0, y: float = 0.0, z: float = 0.0, speed: int | None = None) -> None:
        body: dict = {"command": "jog", "x": x, "y": y, "z": z}
        if speed is not None:
            body["speed"] = speed
        self._request("POST", "/api/printer/printhead", json=body)

    def gcode(self, commands: list[str]) -> None:
        self._request("POST", "/api/printer/command", json={"commands": commands})
