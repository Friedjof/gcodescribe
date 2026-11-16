"""Resolve an explicit project context without changing the global profile."""

from __future__ import annotations

from fastapi import HTTPException

from plotter.core.calibration import Calibration
from plotter.web.deps import document_store, profile_service


def active_project_profile(project_id: str, profile_id: str | None = None) -> dict:
    project = document_store().list_pages()["project"]
    if project["id"] != project_id or (profile_id and project["profileId"] != profile_id):
        raise HTTPException(
            409, "Das aktive Projekt oder sein Profil hat sich geändert. Bitte neu öffnen."
        )
    return profile_service().get(project["profileId"])


def project_calibration(
    project_id: str | None, profile_id: str | None = None
) -> Calibration | None:
    if project_id is None and profile_id is None:
        return None
    profile = calibration_profile(project_id, profile_id, motion=True)
    return profile_service().calibration(profile["id"])


def calibration_profile(
    project_id: str | None, profile_id: str | None = None, *, motion: bool = False
) -> dict:
    """Resolve editor requests without activating a profile or rebinding a project."""
    if project_id is not None:
        return active_project_profile(project_id, profile_id)
    profile = profile_service().get(profile_id) if profile_id else profile_service().active()
    if motion and (profile["archived"] or profile_service().active()["id"] != profile["id"]):
        raise HTTPException(409, "Zum Bewegen bitte zuerst dieses Profil aktivieren.")
    return profile
