from __future__ import annotations

import threading

from plotter.core.jsonstore import new_id, now
from plotter.core.state import StateStore

from .common import _profile_snapshot


class DocumentState:
    """One lock and index for all repositories in a document session."""

    INDEX_KEY = "paint_index"

    def __init__(self, store: StateStore):
        self.store = store
        self.lock = threading.RLock()

    def index(self) -> dict:
        index = self.store.get(self.INDEX_KEY) or {"order": [], "activeId": None}
        # Old indexes had only flat folders and a global slide order.
        index.setdefault("groups", [])
        if "projects" not in index:
            index = self.migrate_projects(index)
        return index

    def migrate_projects(self, index: dict) -> dict:
        """Keep existing page IDs and objects; split old profile groups into projects."""
        from plotter.services.profiles import ProfileService

        if self.store.get("paint_index_before_projects") is None:
            self.store.set("paint_index_before_projects", index)
            for meta in index["order"]:
                old_page = self.store.get(self.page_key(meta["id"]))
                if old_page:
                    self.store.set(f"paint_page_before_projects_{meta['id']}", old_page)
        service = ProfileService()
        active = service.active_profile_meta()
        by_profile: dict[str, dict] = {}
        profiles = {p["id"]: p for p in service.list(include_archived=True)}
        for meta in index["order"]:
            key = meta.get("profileId") or "__legacy__"
            if key not in by_profile:
                profile_id = meta.get("profileId") or active["id"]
                project = {
                    "id": new_id("proj-", 8),
                    "name": meta.get("profileName")
                    or profiles.get(profile_id, {}).get("name")
                    or "Importierte Slides",
                    "profileId": profile_id,
                    "activeId": None,
                    "modified": 0,
                    "archived": False,
                }
                by_profile[key] = project
            if meta["id"] == index.get("activeId"):
                by_profile[key]["activeId"] = meta["id"]
        if not by_profile:
            by_profile[active["id"]] = {
                "id": new_id("proj-", 8),
                "name": "Mein Projekt",
                "profileId": active["id"],
                "activeId": None,
                "modified": now(),
                "archived": False,
            }
        groups = {
            (group.get("id"), key): {
                "id": new_id("g-", 8),
                "name": group.get("name") or "Ordner",
                "projectId": project["id"],
                "parentId": None,
            }
            for key, project in by_profile.items()
            for group in index["groups"]
            if any(
                (m.get("profileId") or "__legacy__") == key and m.get("groupId") == group.get("id")
                for m in index["order"]
            )
        }
        new_order = []
        for meta in index["order"]:
            page = self.store.get(self.page_key(meta["id"]))
            if not page:
                continue
            key = page.get("profileId") or "__legacy__"
            project = by_profile[key]
            page["projectId"] = project["id"]
            folder = groups.get((page.get("groupId"), key))
            page["groupId"] = folder["id"] if folder else None
            snapshot = _profile_snapshot(page.get("profileId"), page.get("profileFingerprint"))
            if snapshot:
                page["profileSnapshot"] = snapshot
            self.store.set(self.page_key(page["id"]), page)
            new_order.append(self.meta(page))
            project["activeId"] = project["activeId"] or page["id"]
            project["modified"] = max(project.get("modified", 0), page.get("modified", 0))
        index["order"] = new_order
        index["groups"] = list(groups.values())
        index["projects"] = list(by_profile.values())
        active_page = next((m for m in new_order if m["id"] == index.get("activeId")), None)
        index["activeProjectId"] = (
            (active_page or new_order[0])["projectId"] if new_order else index["projects"][0]["id"]
        )
        self.save_index(index)
        return index

    def save_index(self, index: dict) -> None:
        self.store.set(self.INDEX_KEY, index)

    @staticmethod
    def meta(page: dict) -> dict:
        objects = page.get("objects", [])
        return {
            "id": page["id"],
            "name": page["name"],
            "created": page.get("created", 0.0),
            "modified": page.get("modified", 0.0),
            "objectCount": len(objects),
            "plottedCount": sum(1 for o in objects if o.get("plotted")),
            "thumb": page.get("thumb"),
            # Profile the page was created for. Old pages have no profile
            # fields; they are reported as "missing" and must be adopted
            # explicitly (never silently bound to the active profile).
            "profileId": page.get("profileId"),
            "profileName": page.get("profileName"),
            "profileFingerprint": page.get("profileFingerprint"),
            # Manual folder the page was dragged into (None = grouped by profile).
            "groupId": page.get("groupId"),
            "projectId": page.get("projectId"),
            "mcpCreated": bool((page.get("mcp") or {}).get("created")),
        }

    def page_key(self, page_id: str) -> str:
        return f"paint_page_{page_id}"

    @staticmethod
    def project_view(index: dict) -> dict:
        project_id = index["activeProjectId"]
        project = next(p for p in index["projects"] if p["id"] == project_id)
        order = [m for m in index["order"] if m.get("projectId") == project_id]
        groups = [g for g in index["groups"] if g.get("projectId") == project_id]
        return {
            "order": order,
            "groups": groups,
            "activeId": project.get("activeId"),
            "project": project,
            "projects": index["projects"],
        }

    def refresh_meta(self, page: dict) -> None:
        index = self.index()
        meta = self.meta(page)
        for i, m in enumerate(index["order"]):
            if m["id"] == page["id"]:
                index["order"][i] = meta
                break
        for project in index["projects"]:
            if project["id"] == page.get("projectId"):
                project["modified"] = page.get("modified", now())
                break
        self.save_index(index)
