from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import time
import uuid
from dataclasses import fields
from pathlib import Path

from ..calibration import Calibration, data_dir
from .errors import ServiceError


class ProfileError(ServiceError):
    """Profile operation failed (missing, archived, conflict, …)."""


class ProfileNotFound(ProfileError):
    status_code = 404


class ProfileConflict(ProfileError):
    status_code = 409


class ProfileImportError(ProfileError):
    """The uploaded JSON is not a valid profile / bundle document."""


# Bump when the meaning of fingerprinted fields changes, so old fingerprints
# can never accidentally match new ones.
FINGERPRINT_VERSION = 1

# Safety-relevant calibration fields. Profile metadata (name, timestamps,
# archived) is deliberately excluded so renaming never makes jobs stale.
FINGERPRINT_FIELDS = (
    "bed_width",
    "bed_height",
    "plot_width",
    "plot_height",
    "origin_x",
    "origin_y",
    "pen_up_z",
    "pen_down_z",
    "pen_calibrated",
    "travel_feed",
    "draw_feed",
    "z_feed",
    "fit_to_area",
    "flip_y",
    "paper_corners",
    "paper_margin",
)

PROFILE_FORMAT = "gcodescribe-profile"
BUNDLE_FORMAT = "gcodescribe-profile-bundle"
FORMAT_VERSION = 1

DEFAULT_PROFILE_NAME = "Standard"

# All profile files live under one directory; a single process-wide lock keeps
# read-modify-write cycles (activate, update, migrate) atomic.
_lock = threading.RLock()


def calibration_fingerprint(cal: Calibration | dict) -> str:
    data = cal.as_dict() if isinstance(cal, Calibration) else dict(cal)
    payload = {"_v": FINGERPRINT_VERSION}
    payload.update({key: data.get(key) for key in FINGERPRINT_FIELDS})
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _atomic_write(path: Path, payload: dict) -> None:
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(path)


def _new_id() -> str:
    return "prof-" + uuid.uuid4().hex[:8]


def _now() -> float:
    return time.time()


class ProfileService:
    """File-based store for calibration profiles under ``<data>/profiles/``.

    The profile store is the source of truth for the active calibration;
    ``<data>/calibration.json`` is kept as a compatible mirror so every
    existing ``Calibration.load()`` call keeps seeing the active profile.
    """

    ACTIVE_FILE = "active.json"

    def __init__(self, root: Path | None = None):
        self.root = root or (data_dir() / "profiles")

    # -- low-level files -----------------------------------------------------

    def _profile_path(self, profile_id: str) -> Path:
        return self.root / f"{Path(profile_id).name}.json"

    def _read(self, profile_id: str) -> dict | None:
        path = self._profile_path(profile_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return None

    def _write(self, profile: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        _atomic_write(self._profile_path(profile["id"]), profile)

    def _profile_ids(self) -> list[str]:
        if not self.root.exists():
            return []
        return [
            p.stem
            for p in self.root.glob("*.json")
            if p.name != self.ACTIVE_FILE and not p.name.startswith(".")
        ]

    def _write_mirror(self, cal_data: dict) -> None:
        # Direct JSON write — *not* Calibration.save(), which would call back
        # into this module to sync the active profile.
        _atomic_write(data_dir() / "calibration.json", cal_data)

    # -- migration -----------------------------------------------------------

    def ensure_migrated(self) -> None:
        """Create a default profile from the legacy ``calibration.json``.

        Idempotent: runs only while no profile files exist. The legacy file is
        kept (it doubles as the active-calibration mirror); a one-time backup
        preserves the pre-profile state.
        """
        with _lock:
            if self._profile_ids():
                return
            legacy = data_dir() / "calibration.json"
            if legacy.exists():
                backup = legacy.with_suffix(".json.pre-profiles.bak")
                if not backup.exists():
                    shutil.copy2(legacy, backup)
            cal = Calibration.load()
            profile = self._build(DEFAULT_PROFILE_NAME, cal.as_dict())
            self._write(profile)
            self._set_active_id(profile["id"], mirror=cal.as_dict())

    # -- active profile ------------------------------------------------------

    def _set_active_id(self, profile_id: str, mirror: dict | None = None) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        _atomic_write(self.root / self.ACTIVE_FILE, {"active_id": profile_id})
        if mirror is not None:
            self._write_mirror(mirror)

    def active_id(self) -> str:
        with _lock:
            self.ensure_migrated()
            path = self.root / self.ACTIVE_FILE
            active_id = None
            if path.exists():
                try:
                    active_id = json.loads(path.read_text()).get("active_id")
                except (OSError, json.JSONDecodeError):
                    active_id = None
            if active_id and self._read(active_id) is not None:
                return active_id
            # Self-heal: fall back to the first non-archived profile.
            for pid in sorted(self._profile_ids()):
                profile = self._read(pid)
                if profile and not profile.get("archived"):
                    self._set_active_id(pid, mirror=profile["calibration"])
                    return pid
            raise ProfileNotFound("Kein aktives Profil vorhanden.")

    def active(self) -> dict:
        with _lock:
            return self.get(self.active_id())

    def active_calibration(self) -> Calibration:
        return Calibration().merged(self.active()["calibration"])

    def active_profile_meta(self) -> dict:
        """Compact profile reference for job sidecars / G-code comments."""
        return profile_meta(self.active())

    def activate(self, profile_id: str) -> dict:
        with _lock:
            self.ensure_migrated()
            profile = self._require(profile_id)
            if profile.get("archived"):
                raise ProfileConflict(
                    "Archivierte Profile können nicht aktiviert werden — zuerst wiederherstellen."
                )
            self._set_active_id(profile["id"], mirror=profile["calibration"])
            return self._full(profile)

    def sync_active_from_calibration(self, cal: Calibration) -> None:
        """Mirror -> profile sync, called from ``Calibration.save()``.

        Keeps the active profile authoritative when legacy code paths
        (paper service, pen calibration, PUT /calibration) write the global
        calibration file directly.
        """
        with _lock:
            try:
                profile = self._read(self.active_id())
            except ProfileError:
                return
            if profile is None:
                return
            data = cal.as_dict()
            if profile["calibration"] == data:
                return
            profile["calibration"] = data
            profile["fingerprint"] = calibration_fingerprint(data)
            profile["modified"] = _now()
            self._write(profile)

    # -- queries ---------------------------------------------------------------

    def _require(self, profile_id: str) -> dict:
        profile = self._read(profile_id)
        if profile is None:
            raise ProfileNotFound(f"Profil nicht gefunden: {profile_id}")
        return profile

    def _summary(self, profile: dict, active_id: str) -> dict:
        cal = profile.get("calibration", {})
        return {
            "id": profile["id"],
            "name": profile["name"],
            "active": profile["id"] == active_id,
            "archived": bool(profile.get("archived")),
            "created": profile.get("created", 0.0),
            "modified": profile.get("modified", 0.0),
            "fingerprint": profile.get("fingerprint", ""),
            "plot_width": cal.get("plot_width"),
            "plot_height": cal.get("plot_height"),
            "origin_x": cal.get("origin_x"),
            "origin_y": cal.get("origin_y"),
            "paper_margin": cal.get("paper_margin"),
            "pen_calibrated": bool(cal.get("pen_calibrated")),
        }

    def _full(self, profile: dict) -> dict:
        with _lock:
            return {
                **self._summary(profile, self.active_id()),
                "calibration": profile["calibration"],
            }

    def list(self, include_archived: bool = True) -> list[dict]:
        with _lock:
            self.ensure_migrated()
            active_id = self.active_id()
            profiles = [p for pid in self._profile_ids() if (p := self._read(pid))]
            if not include_archived:
                profiles = [p for p in profiles if not p.get("archived")]
            profiles.sort(key=lambda p: (p.get("archived", False), p.get("created", 0.0)))
            return [self._summary(p, active_id) for p in profiles]

    def get(self, profile_id: str) -> dict:
        with _lock:
            self.ensure_migrated()
            return self._full(self._require(profile_id))

    # -- mutations ---------------------------------------------------------------

    def _build(self, name: str, cal_data: dict, profile_id: str | None = None) -> dict:
        known = {f.name for f in fields(Calibration)}
        clean = Calibration().merged({k: v for k, v in cal_data.items() if k in known})
        now = _now()
        data = clean.as_dict()
        return {
            "id": profile_id or _new_id(),
            "name": name,
            "created": now,
            "modified": now,
            "archived": False,
            "fingerprint": calibration_fingerprint(data),
            "calibration": data,
        }

    def _unique_name(self, wanted: str) -> str:
        taken = {p["name"] for pid in self._profile_ids() if (p := self._read(pid))}
        if wanted not in taken:
            return wanted
        n = 2
        while f"{wanted} ({n})" in taken:
            n += 1
        return f"{wanted} ({n})"

    def create(self, name: str | None = None, calibration: dict | None = None) -> dict:
        """New profile; calibration defaults to a copy of the active one."""
        with _lock:
            self.ensure_migrated()
            cal_data = calibration if calibration is not None else self.active()["calibration"]
            profile = self._build(
                self._unique_name((name or "").strip() or "Neues Profil"), cal_data
            )
            self._write(profile)
            return self._full(profile)

    def update(
        self,
        profile_id: str,
        *,
        name: str | None = None,
        calibration: dict | None = None,
    ) -> dict:
        with _lock:
            self.ensure_migrated()
            profile = self._require(profile_id)
            if name is not None and name.strip():
                profile["name"] = name.strip()
            if calibration is not None:
                known = {f.name for f in fields(Calibration)}
                merged = (
                    Calibration()
                    .merged(profile["calibration"])
                    .merged({k: v for k, v in calibration.items() if k in known})
                )
                profile["calibration"] = merged.as_dict()
                profile["fingerprint"] = calibration_fingerprint(profile["calibration"])
            profile["modified"] = _now()
            self._write(profile)
            if profile["id"] == self.active_id():
                self._write_mirror(profile["calibration"])
            return self._full(profile)

    def duplicate(self, profile_id: str, name: str | None = None) -> dict:
        with _lock:
            self.ensure_migrated()
            src = self._require(profile_id)
            wanted = (name or "").strip() or f"{src['name']} (Kopie)"
            profile = self._build(self._unique_name(wanted), src["calibration"])
            self._write(profile)
            return self._full(profile)

    def archive(self, profile_id: str) -> dict:
        with _lock:
            self.ensure_migrated()
            profile = self._require(profile_id)
            if profile["id"] == self.active_id():
                raise ProfileConflict(
                    "Das aktive Profil kann nicht archiviert werden — zuerst ein "
                    "anderes aktivieren."
                )
            profile["archived"] = True
            profile["modified"] = _now()
            self._write(profile)
            return self._full(profile)

    def unarchive(self, profile_id: str) -> dict:
        with _lock:
            self.ensure_migrated()
            profile = self._require(profile_id)
            profile["archived"] = False
            profile["modified"] = _now()
            self._write(profile)
            return self._full(profile)

    # -- import / export ---------------------------------------------------------

    def export_profile(self, profile_id: str) -> dict:
        with _lock:
            profile = self._require(profile_id)
            return {
                "format": PROFILE_FORMAT,
                "version": FORMAT_VERSION,
                "profile": {
                    "name": profile["name"],
                    "fingerprint": profile.get("fingerprint", ""),
                    "calibration": profile["calibration"],
                },
            }

    def export_bundle(self) -> dict:
        with _lock:
            self.ensure_migrated()
            active_id = self.active_id()
            profiles = [p for pid in sorted(self._profile_ids()) if (p := self._read(pid))]
            return {
                "format": BUNDLE_FORMAT,
                "version": FORMAT_VERSION,
                "active_profile_id": active_id,
                "profiles": profiles,
            }

    @staticmethod
    def _check_format(payload: dict, expected: str) -> None:
        if not isinstance(payload, dict) or payload.get("format") != expected:
            raise ProfileImportError(f"Kein gültiges Dokument (format != {expected!r}).")
        if payload.get("version") != FORMAT_VERSION:
            raise ProfileImportError(f"Nicht unterstützte Version: {payload.get('version')!r}.")

    def import_profile(self, payload: dict) -> dict:
        """Import a single profile. Always creates a new id, never activates."""
        with _lock:
            self.ensure_migrated()
            self._check_format(payload, PROFILE_FORMAT)
            raw = payload.get("profile")
            if not isinstance(raw, dict) or not isinstance(raw.get("calibration"), dict):
                raise ProfileImportError("Dem Profil fehlt die Kalibrierung.")
            name = self._unique_name(str(raw.get("name") or "Importiertes Profil"))
            profile = self._build(name, raw["calibration"])
            self._write(profile)
            return self._full(profile)

    def import_bundle(self, payload: dict, replace: bool = False) -> dict:
        """Import a bundle. Default: every entry becomes a new profile.

        With ``replace=True`` profiles with a matching existing id are
        overwritten in place. The active profile is never switched.
        """
        with _lock:
            self.ensure_migrated()
            self._check_format(payload, BUNDLE_FORMAT)
            entries = payload.get("profiles")
            if not isinstance(entries, list) or not entries:
                raise ProfileImportError("Das Bundle enthält keine Profile.")
            imported, replaced, skipped = [], [], []
            for raw in entries:
                if not isinstance(raw, dict) or not isinstance(raw.get("calibration"), dict):
                    skipped.append(
                        str((raw or {}).get("name", "?")) if isinstance(raw, dict) else "?"
                    )
                    continue
                existing = self._read(str(raw.get("id", ""))) if raw.get("id") else None
                if replace and existing is not None:
                    updated = self.update(
                        existing["id"],
                        name=str(raw.get("name") or existing["name"]),
                        calibration=raw["calibration"],
                    )
                    replaced.append(updated["name"])
                else:
                    name = self._unique_name(str(raw.get("name") or "Importiertes Profil"))
                    profile = self._build(name, raw["calibration"])
                    self._write(profile)
                    imported.append(profile["name"])
            return {
                "imported": imported,
                "replaced": replaced,
                "skipped": skipped,
                "profiles": self.list(),
            }


def profile_meta(profile: dict) -> dict:
    """Compact profile reference for job sidecars / G-code comments."""
    cal = profile.get("calibration", {})
    return {
        "id": profile["id"],
        "name": profile["name"],
        "fingerprint": profile["fingerprint"],
        "plot_width": cal.get("plot_width"),
        "plot_height": cal.get("plot_height"),
        "origin_x": cal.get("origin_x"),
        "origin_y": cal.get("origin_y"),
    }


def sync_active_profile_calibration(cal: Calibration) -> None:
    """Hook for ``Calibration.save()``: push the mirror into the active profile."""
    ProfileService().sync_active_from_calibration(cal)
