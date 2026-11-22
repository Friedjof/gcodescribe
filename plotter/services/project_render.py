from __future__ import annotations

from dataclasses import replace

from plotter.core.calibration import Calibration, same_plot_layout, slide_calibration_differences
from plotter.core.document import get_document_store

from .errors import ServiceError
from .profiles import ProfileError, ProfileService


def page_project_profile(page: dict) -> tuple[dict, Calibration]:
    """Resolve the current project setup used by both the editor and plotting."""
    project = next((project for project in get_document_store().projects()
                    if project["id"] == page.get("projectId")), None)
    if not project or project.get("archived"):
        raise ServiceError("Das Projekt dieses Slides ist nicht vorhanden oder archiviert.")
    profile = ProfileService().get(project["profileId"])
    if profile.get("archived"):
        raise ServiceError("Das Kalibrierungsprofil dieses Projekts ist archiviert.")
    return profile, Calibration.from_dict(profile["calibration"])


class ProjectJobError(ValueError):
    """A project job no longer has a safe, matching slide calibration."""


def project_job_calibration(meta: dict) -> Calibration:
    """Reject already rendered jobs when their current project setup changed."""
    source = meta.get("source") or {}
    snapshot = meta.get("calibrationSnapshot") or {}
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("calibration"), dict):
        raise ProjectJobError(
            "Dem Projekt-Job fehlt die gespeicherte Kalibrierung. Bitte den Job erneut erzeugen."
        )
    if source.get("kind") in ("paint_page", "paint_coloring"):
        page = get_document_store().get_page(source.get("page_id"))
        if not page or page.get("projectId") != source.get("project_id"):
            raise ProjectJobError(
                "Der Slide wurde gelöscht oder in ein anderes Projekt verschoben. "
                "Bitte den Job erneut erzeugen."
            )
    profile = meta.get("profile") or {}
    if (profile.get("id") != snapshot.get("profileId")
            or profile.get("fingerprint") != snapshot.get("fingerprint")):
        raise ProjectJobError("Die Profilangaben des Jobs passen nicht zur Slide-Kalibrierung.")
    project = next((p for p in get_document_store().projects()
                    if p["id"] == source.get("project_id")), None)
    if not project or project.get("archived"):
        raise ProjectJobError("Das Projekt des Slides ist nicht vorhanden oder archiviert.")
    if snapshot.get("profileId") != project["profileId"]:
        raise ProjectJobError(
            "Das Profil des Projekts wurde gewechselt. Bitte diesen G-Code erneut erzeugen."
        )
    try:
        saved = Calibration.from_dict(snapshot["calibration"])
        current_profile = ProfileService().get(project["profileId"])
        current = Calibration.from_dict(current_profile["calibration"])
    except (KeyError, TypeError, ValueError, ProfileError) as exc:
        raise ProjectJobError(f"Slide-Kalibrierung kann nicht gelesen werden: {exc}") from exc
    if current_profile.get("archived"):
        raise ProjectJobError("Das Kalibrierungsprofil dieses Projekts ist archiviert.")
    if (profile.get("fingerprint") != current_profile["fingerprint"]
            or not same_plot_layout(saved, current)
            or any(getattr(saved, key) != getattr(current, key) for key in
                   ("travel_feed", "draw_feed", "z_feed", "z_max_feedrate", "merge_tolerance",
                    "trust_axis_home"))):
        differences = slide_calibration_differences(saved, current)
        raise ProjectJobError(
            "Dieser G-Code wurde mit einer älteren Projektkalibrierung erzeugt. "
            f"{differences} Bitte im Designer erneut auf Vorschau oder Plot klicken, "
            "damit die aktuelle Kalibrierung verwendet wird."
        )
    # Project jobs use their project's current physical limits. A legacy
    # default profile must not shrink an unrelated project's machine area.
    physical = replace(saved,
                       bed_width=min(saved.bed_width, current.bed_width),
                       bed_height=min(saved.bed_height, current.bed_height),
                       z_max=min(saved.z_max, current.z_max))
    if max(saved.pen_up_z, saved.pen_down_z, saved.resolved_park()[2]) > physical.z_max:
        raise ProjectJobError(
            "Die gespeicherte Stifthöhe überschreitet die aktuelle Z-Grenze des Projekts."
        )
    return physical
