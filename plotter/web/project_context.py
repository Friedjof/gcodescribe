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
    if project_id is None:
        return None
    profile = active_project_profile(project_id, profile_id)
    return profile_service().calibration(profile["id"])
