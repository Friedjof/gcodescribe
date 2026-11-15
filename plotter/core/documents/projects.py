from __future__ import annotations

from plotter.core.jsonstore import new_id, now

from .common import _assignable_project_profile, _emit
from .pages import PageRepository
from .state import DocumentState


class ProjectRepository:
    def __init__(self, data: DocumentState, pages: PageRepository):
        self.data = data
        self.pages = pages

    def projects(self) -> list[dict]:
        with self.data.lock:
            index = self.data.index()
            result = []
            for project in index["projects"]:
                slides = [m for m in index["order"] if m.get("projectId") == project["id"]]
                cover = next(
                    (
                        m
                        for m in slides
                        if m["id"] == project.get("activeId") and m.get("objectCount", 0) > 0
                    ),
                    None,
                )
                if cover is None:
                    cover = next(
                        (
                            m
                            for m in sorted(
                                slides, key=lambda m: m.get("modified", 0), reverse=True
                            )
                            if m.get("objectCount", 0) > 0
                        ),
                        None,
                    )
                if cover is None:
                    cover = next((m for m in slides if m["id"] == project.get("activeId")), None)
                result.append(
                    {
                        **project,
                        "slideCount": len(slides),
                        "coverPageId": cover["id"] if cover else None,
                        "coverModified": cover.get("modified", 0) if cover else None,
                    }
                )
            return result

    def create_project(
        self, name: str, template_profile_id: str | None = None, *, profile_id: str | None = None
    ) -> dict:
        from plotter.services.profiles import ProfileConflict, ProfileService

        with self.data.lock:
            index = self.data.index()
            if profile_id is not None:
                if template_profile_id is not None:
                    raise ProfileConflict(
                        "Bitte entweder ein vorhandenes Profil oder eine Profilvorlage auswählen."
                    )
                profile = _assignable_project_profile(profile_id)
            else:
                service = ProfileService()
                template_id = template_profile_id or next(
                    p["profileId"] for p in index["projects"] if p["id"] == index["activeProjectId"]
                )
                profile = service.duplicate(
                    template_id, f"{name.strip() or 'Neues Projekt'} – Profil"
                )
            project = {
                "id": new_id("proj-", 8),
                "name": name.strip() or "Neues Projekt",
                "profileId": profile["id"],
                "activeId": None,
                "modified": now(),
                "archived": False,
            }
            index["projects"].append(project)
            index["activeProjectId"] = project["id"]
            self.data.save_index(index)
            self.pages.create_page(project_id=project["id"])
            _emit("project")
            return self.data.project_view(self.data.index())

    def activate_project(self, project_id: str) -> dict:
        with self.data.lock:
            index = self.data.index()
            project = next(
                (p for p in index["projects"] if p["id"] == project_id and not p.get("archived")),
                None,
            )
            if not project:
                raise KeyError(project_id)
            index["activeProjectId"] = project_id
            self.data.save_index(index)
            if not project.get("activeId"):
                self.pages.create_page(project_id=project_id)
                index = self.data.index()
            _emit("project")
            return self.data.project_view(index)

    def update_project(
        self,
        project_id: str,
        *,
        name: str | None = None,
        archived: bool | None = None,
        profile_id: str | None = None,
    ) -> dict:
        with self.data.lock:
            index = self.data.index()
            project = next((p for p in index["projects"] if p["id"] == project_id), None)
            if not project:
                raise KeyError(project_id)
            # Validate the complete request before changing project metadata.
            profile = _assignable_project_profile(profile_id) if profile_id is not None else None
            if name is not None and name.strip():
                project["name"] = name.strip()
            if archived is not None:
                project["archived"] = archived
            if profile is not None:
                project["profileId"] = profile["id"]
            project["modified"] = now()
            if project.get("archived") and index["activeProjectId"] == project_id:
                other = next((p for p in index["projects"] if not p.get("archived")), None)
                if not other:
                    raise ValueError("Das letzte Projekt kann nicht archiviert werden.")
                index["activeProjectId"] = other["id"]
            self.data.save_index(index)
            _emit("project")
            return project
