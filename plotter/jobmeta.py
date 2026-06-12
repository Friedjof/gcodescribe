from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .services.profiles import ProfileService


def job_meta_path(gcode_path: Path) -> Path:
    """Sidecar JSON next to the job: ``foo.gcode`` -> ``foo.json``."""
    return gcode_path.with_suffix(".json")


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(path)


def write_job_meta(
    gcode_path: Path,
    source: dict | None = None,
    profile: dict | None = None,
) -> dict:
    """Write the job sidecar; the profile defaults to the active one."""
    meta = {
        "filename": gcode_path.name,
        "created": time.time(),
        "source": source or {"kind": "unknown"},
        "profile": profile or ProfileService().active_profile_meta(),
    }
    _atomic_write_json(job_meta_path(gcode_path), meta)
    return meta


def read_job_meta(gcode_path: Path) -> dict | None:
    meta, _ = read_job_meta_checked(gcode_path)
    return meta


def read_job_meta_checked(gcode_path: Path) -> tuple[dict | None, str | None]:
    """Read sidecar and report parse/read errors separately from missing files."""
    path = job_meta_path(gcode_path)
    if not path.exists():
        return None, None
    try:
        payload = json.loads(path.read_text())
    except OSError as exc:
        return None, f"Job-Metadaten konnten nicht gelesen werden: {exc}"
    except json.JSONDecodeError as exc:
        return None, f"Job-Metadaten sind beschädigt: {exc.msg}"
    if not isinstance(payload, dict):
        return None, "Job-Metadaten sind beschädigt: JSON-Wurzel ist kein Objekt."
    return payload, None


def rename_job_meta(src: Path, dst: Path) -> None:
    """Move the sidecar along with its job; missing sidecars are fine."""
    src_meta = job_meta_path(src)
    if not src_meta.exists():
        return
    meta, error = read_job_meta_checked(src)
    dst_meta = job_meta_path(dst)
    if dst_meta.exists():
        raise FileExistsError(dst_meta)
    if error is not None or meta is None:
        # Keep an invalid sidecar attached to the renamed job for diagnosis;
        # do not try to rewrite content we cannot trust.
        src_meta.rename(dst_meta)
        return
    meta["filename"] = dst.name
    _atomic_write_json(dst_meta, meta)
    src_meta.unlink(missing_ok=True)


def delete_job_meta(gcode_path: Path) -> None:
    job_meta_path(gcode_path).unlink(missing_ok=True)


def job_profile_status(
    meta: dict | None,
    active: dict,
    profiles: dict[str, dict] | None = None,
) -> dict:
    """Runtime profile status of a job against the active profile.

    Computed on every listing, never persisted — a profile edit or switch
    must immediately change the result.
    """
    profile = (meta or {}).get("profile") or {}
    profile_id = profile.get("id")
    if not profile_id:
        return {
            "id": None,
            "name": None,
            "fingerprint": None,
            "matchesActive": False,
            "stale": False,
            "legacy": True,
            "missing": False,
            "archived": False,
        }
    known = profiles.get(profile_id) if profiles is not None else None
    missing = profiles is not None and known is None
    archived = bool(known.get("archived")) if known is not None else False
    stale = profile_id == active["id"] and profile.get("fingerprint") != active["fingerprint"]
    return {
        "id": profile_id,
        "name": profile.get("name"),
        "fingerprint": profile.get("fingerprint"),
        "matchesActive": profile_id == active["id"] and not stale and not missing and not archived,
        "stale": stale,
        "legacy": False,
        "missing": missing,
        "archived": archived,
    }


def profile_comment(profile: dict) -> str:
    """Human-readable profile block for generated G-code.

    Informational only — the sidecar stays the authoritative source.
    """
    return (
        "; --- plotter profile ---\n"
        f"; profile_id = {profile.get('id')}\n"
        f"; profile_name = {profile.get('name')}\n"
        f"; profile_fingerprint = {profile.get('fingerprint')}\n"
        "; -----------------------\n"
    )
