from __future__ import annotations

from plotter.core.events import hub
from plotter.core.jsonstore import now


def _emit(action: str, *, page_id: str | None = None, mcp: bool = False) -> None:
    """Notify connected clients that the document changed so they can refresh
    the page list (and the open page) live, without a manual reload."""
    hub.publish("document", action=action, pageId=page_id, mcp=mcp)


# Default grid: five granularity levels in mm (coarse -> fine).
GRID_STEPS = [50, 25, 10, 5, 1]
DEFAULT_GRID = {"step": 10, "snap": False}


def _profile_snapshot(profile_id: str | None, fingerprint: str | None = None) -> dict | None:
    if not profile_id:
        return None
    try:
        from plotter.services.profiles import ProfileService

        profile = ProfileService().get(profile_id)
        if fingerprint is not None and profile["fingerprint"] != fingerprint:
            return None  # the earlier calibration cannot be reconstructed
        return {
            "profileId": profile["id"],
            "profileName": profile["name"],
            "fingerprint": profile["fingerprint"],
            "calibration": profile["calibration"],
            "capturedAt": now(),
        }
    except Exception:
        return None


def _assignable_project_profile(profile_id: str) -> dict:
    from plotter.services.profiles import ProfileConflict, ProfileService

    profile = ProfileService().get(profile_id)
    if profile.get("archived"):
        raise ProfileConflict(
            "Archivierte Profile können keinem Projekt zugeordnet werden. "
            "Bitte das Profil zuerst wiederherstellen."
        )
    return profile


class RevisionConflict(Exception):
    """An editor attempted to overwrite a newer document revision."""
