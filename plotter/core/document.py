from __future__ import annotations

import threading
import uuid

from plotter.core.events import hub
from plotter.core.jsonstore import new_id, now
from plotter.core.state import StateStore, create_store


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


class DocumentStore:
    """Project and slide tree, persisted in the state store (Redis/file).

    Layout in the store:
      ``paint_index`` -> projects, folders, active project and slide metadata
      ``paint_page_<id>`` -> the full page (objects, grid, …)

    The index holds only lightweight metadata so the page list is cheap to
    load; the (potentially large) per-page objects live under their own key
    and are written only when that page changes.
    """

    INDEX_KEY = "paint_index"

    def __init__(self, store: StateStore):
        self._store = store
        self._lock = threading.RLock()

    # -- index helpers -----------------------------------------------------

    def _index(self) -> dict:
        index = self._store.get(self.INDEX_KEY) or {"order": [], "activeId": None}
        # Old indexes had only flat folders and a global slide order.
        index.setdefault("groups", [])
        if "projects" not in index:
            index = self._migrate_projects(index)
        return index

    def _migrate_projects(self, index: dict) -> dict:
        """Keep existing page IDs and objects; split old profile groups into projects."""
        from plotter.services.profiles import ProfileService

        if self._store.get("paint_index_before_projects") is None:
            self._store.set("paint_index_before_projects", index)
            for meta in index["order"]:
                old_page = self._store.get(self._page_key(meta["id"]))
                if old_page:
                    self._store.set(f"paint_page_before_projects_{meta['id']}", old_page)
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
            page = self._store.get(self._page_key(meta["id"]))
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
            self._store.set(self._page_key(page["id"]), page)
            new_order.append(self._meta(page))
            project["activeId"] = project["activeId"] or page["id"]
            project["modified"] = max(project.get("modified", 0), page.get("modified", 0))
        index["order"] = new_order
        index["groups"] = list(groups.values())
        index["projects"] = list(by_profile.values())
        active_page = next((m for m in new_order if m["id"] == index.get("activeId")), None)
        index["activeProjectId"] = (
            (active_page or new_order[0])["projectId"] if new_order else index["projects"][0]["id"]
        )
        self._save_index(index)
        return index

    def _save_index(self, index: dict) -> None:
        self._store.set(self.INDEX_KEY, index)

    @staticmethod
    def _meta(page: dict) -> dict:
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

    def _page_key(self, page_id: str) -> str:
        return f"paint_page_{page_id}"

    # -- queries -----------------------------------------------------------

    def list_pages(self) -> dict:
        """Index document: ordered page metadata + the active page id."""
        with self._lock:
            index = self._index()
            # Ensure there is always at least one page to work on.
            if not any(m.get("projectId") == index["activeProjectId"] for m in index["order"]):
                self._create_locked(project_id=index["activeProjectId"])
                index = self._index()
            return self._project_view(index)

    @staticmethod
    def _project_view(index: dict) -> dict:
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

    def get_page(self, page_id: str) -> dict | None:
        with self._lock:
            return self._store.get(self._page_key(page_id))

    def get_thumbnail(self, page_id: str) -> dict | None:
        """Build a small drawing preview on demand, never during index updates."""
        with self._lock:
            page = self._store.get(self._page_key(page_id))
            if not page or not page.get("id"):
                return None
            key = f"paint_thumb_{page_id}"
            cached = self._store.get(key)
            revision = page.get("revision", 0)
            modified = page.get("modified", 0)
            if (
                cached is not None
                and cached.get("revision") == revision
                and cached.get("modified") == modified
            ):
                return cached
            try:
                from plotter.gcode.scene import page_thumbnail

                thumb = page_thumbnail(page)
            except Exception:
                thumb = None
            result = {"revision": revision, "modified": modified, "thumb": thumb}
            self._store.set(key, result)
            return result

    # -- mutations ---------------------------------------------------------

    def _create_locked(
        self,
        name: str | None = None,
        profile: dict | None = None,
        mcp: dict | None = None,
        project_id: str | None = None,
        folder_id: str | None = None,
    ) -> dict:
        index = self._index()
        project_id = project_id or index["activeProjectId"]
        project = next((p for p in index["projects"] if p["id"] == project_id), None)
        if not project:
            raise KeyError(project_id)
        if folder_id and not any(
            g["id"] == folder_id and g.get("projectId") == project_id for g in index["groups"]
        ):
            raise KeyError(folder_id)
        if profile is None:
            from plotter.services.profiles import ProfileService, profile_meta

            profile = profile_meta(ProfileService().get(project["profileId"]))
        page_id = new_id("p-", 6)
        ts = now()
        page = {
            "id": page_id,
            "name": name or page_id,
            "objects": [],
            "grid": dict(DEFAULT_GRID),
            "created": ts,
            "modified": ts,
            "projectId": project_id,
            "groupId": folder_id,
        }
        if profile:
            page["profileId"] = profile.get("id")
            page["profileName"] = profile.get("name")
            page["profileFingerprint"] = profile.get("fingerprint")
            snapshot = _profile_snapshot(profile.get("id"), profile.get("fingerprint"))
            if snapshot:
                page["profileSnapshot"] = snapshot
            else:
                page.pop("profileSnapshot", None)
        if mcp:
            page["mcp"] = dict(mcp)
        self._store.set(self._page_key(page_id), page)
        index["order"].append(self._meta(page))
        index["activeId"] = page_id
        project["activeId"] = page_id
        project["modified"] = ts
        self._save_index(index)
        _emit("create", page_id=page_id, mcp=bool(mcp))
        return page

    def create_page(
        self,
        name: str | None = None,
        profile: dict | None = None,
        mcp: dict | None = None,
        project_id: str | None = None,
        folder_id: str | None = None,
    ) -> dict:
        with self._lock:
            return self._create_locked(name, profile, mcp, project_id, folder_id)

    def set_page_profile(self, page_id: str, profile: dict) -> dict:
        """Explicitly bind a page to a profile (adopt / re-adopt)."""
        with self._lock:
            page = self._store.get(self._page_key(page_id))
            if page is None:
                raise KeyError(page_id)
            page["profileId"] = profile.get("id")
            page["profileName"] = profile.get("name")
            page["profileFingerprint"] = profile.get("fingerprint")
            snapshot = _profile_snapshot(profile.get("id"), profile.get("fingerprint"))
            if snapshot:
                page["profileSnapshot"] = snapshot
            else:
                page.pop("profileSnapshot", None)
            page["modified"] = now()
            page["revision"] = page.get("revision", 0) + 1
            self._store.set(self._page_key(page_id), page)
            self._refresh_meta(page)
            _emit("save", page_id=page_id)
            return page

    def save_page(self, page_id: str, updates: dict) -> dict:
        """Update a page's objects / grid / name (whatever is provided)."""
        with self._lock:
            page = self._store.get(self._page_key(page_id))
            if page is None:
                raise KeyError(page_id)
            expected = updates.get("expected_revision")
            if expected is not None and expected != page.get("revision", 0):
                raise RevisionConflict(page_id)
            for field in ("objects", "grid", "name", "markdown", "coloring", "continuous"):
                if field in updates and updates[field] is not None:
                    page[field] = updates[field]
            page["modified"] = now()
            page["revision"] = page.get("revision", 0) + 1
            self._store.set(self._page_key(page_id), page)
            self._refresh_meta(page)
            _emit("save", page_id=page_id)
            return page

    def patch_objects(
        self,
        page_id: str,
        *,
        revision: int,
        mutation_id: str,
        changes: list[dict],
        removed: list[str],
    ) -> dict:
        """Small, ordered and idempotent editor updates under the document lock."""
        with self._lock:
            page = self._store.get(self._page_key(page_id))
            if not page or not page.get("id"):
                raise KeyError(page_id)
            applied = page.get("_mutations", [])
            if mutation_id in applied:
                return page.get("_mutation_results", {}).get(
                    mutation_id, {"revision": page.get("revision", 0), "modified": page["modified"]}
                )
            if revision != page.get("revision", 0):
                raise RevisionConflict(page_id)
            removed_ids = set(removed)
            objects = {
                obj["id"]: obj for obj in page.get("objects", []) if obj["id"] not in removed_ids
            }
            for change in changes:
                object_id = change["id"]
                objects[object_id] = {**objects.get(object_id, {}), **change}
            page["objects"] = list(objects.values())
            page["_mutations"] = [*applied, mutation_id][-128:]
            page["revision"] = page.get("revision", 0) + 1
            page["modified"] = now()
            results = page.get("_mutation_results", {})
            results[mutation_id] = {"revision": page["revision"], "modified": page["modified"]}
            page["_mutation_results"] = {
                key: results[key] for key in page["_mutations"] if key in results
            }
            self._store.set(self._page_key(page_id), page)
            self._refresh_meta(page)
            _emit("save", page_id=page_id)
            return {"revision": page["revision"], "modified": page["modified"]}

    def rename_page(self, page_id: str, name: str) -> dict:
        return self.save_page(page_id, {"name": name})

    def append_import(
        self,
        page_id: str,
        profile_id: str | None,
        fingerprint: str | None,
        task_id: str,
        obj: dict,
        *,
        project_id: str | None = None,
    ) -> bool:
        """Publish once on the captured page, preserving all intervening edits."""
        with self._lock:
            page = self.get_page(page_id)
            if page is None:
                return False
            applied = page.get("_imports", [])
            if task_id in applied:
                return True
            project = next(
                (p for p in self._index()["projects"] if p["id"] == page.get("projectId")), None
            )
            if (
                not project
                or project.get("archived")
                or (project_id is not None and project["id"] != project_id)
                or project.get("profileId") != profile_id
            ):
                return False
            from plotter.services.profiles import ProfileError, ProfileService

            try:
                profile = ProfileService().get(profile_id)
            except ProfileError:
                return False
            if profile.get("archived") or profile["fingerprint"] != fingerprint:
                return False
            obj = {
                **obj,
                "zOrder": max(
                    (o.get("zOrder", i) for i, o in enumerate(page["objects"])), default=-1
                )
                + 1,
            }
            # Marker and object are persisted in the same state-store write.
            page["_imports"] = [*applied, task_id]
            page["objects"] = [*page["objects"], obj]
            page["modified"] = now()
            page["revision"] = page.get("revision", 0) + 1
            self._store.set(self._page_key(page_id), page)
            self._refresh_meta(page)
            _emit("import", page_id=page_id)
            return True

    def delete_page(self, page_id: str) -> dict:
        with self._lock:
            index = self._index()
            deleted = self._store.get(self._page_key(page_id))
            index["order"] = [m for m in index["order"] if m["id"] != page_id]
            self._store.set(self._page_key(page_id), {})  # tombstone / clear
            if index["activeId"] == page_id:
                index["activeId"] = index["order"][-1]["id"] if index["order"] else None
            project = next(
                (p for p in index["projects"] if p["id"] == (deleted or {}).get("projectId")), None
            )
            if project and project.get("activeId") == page_id:
                project["activeId"] = next(
                    (m["id"] for m in index["order"] if m.get("projectId") == project["id"]), None
                )
            self._save_index(index)
            if project and not project.get("activeId"):
                self._create_locked(project_id=project["id"])
                index = self._index()
            _emit("delete", page_id=page_id)
            return self._project_view(index)

    def duplicate_page(self, page_id: str) -> dict:
        with self._lock:
            src = self._store.get(self._page_key(page_id))
            if src is None:
                raise KeyError(page_id)
            # The copy keeps the source page's profile: its coordinates were
            # laid out for that plot area, not for the active profile.
            copy = self._create_locked(
                name=f"{src['name']} (Kopie)",
                profile={
                    "id": src.get("profileId"),
                    "name": src.get("profileName"),
                    "fingerprint": src.get("profileFingerprint"),
                }
                if src.get("profileId")
                else None,
                project_id=src.get("projectId"),
                folder_id=src.get("groupId"),
            )
            if src.get("profileSnapshot"):
                copy["profileSnapshot"] = src["profileSnapshot"]
            copy["objects"] = src.get("objects", [])
            copy["grid"] = src.get("grid", dict(DEFAULT_GRID))
            if src.get("markdown"):
                copy["markdown"] = src["markdown"]
            copy["modified"] = now()
            self._store.set(self._page_key(copy["id"]), copy)
            self._refresh_meta(copy)
            _emit("save", page_id=copy["id"])
            return copy

    def set_active(self, page_id: str) -> dict:
        with self._lock:
            index = self._index()
            if any(m["id"] == page_id for m in index["order"]):
                index["activeId"] = page_id
                project_id = next(m["projectId"] for m in index["order"] if m["id"] == page_id)
                index["activeProjectId"] = project_id
                next(p for p in index["projects"] if p["id"] == project_id)["activeId"] = page_id
                self._save_index(index)
                _emit("active", page_id=page_id)
            return self._project_view(index)

    def reorder_pages(self, ids: list[str]) -> dict:
        """Reorder the page list to match ``ids``.

        Only known ids are honoured; any pages missing from ``ids`` keep their
        relative order and are appended after the requested ones, so a partial
        or stale list can never drop pages.
        """
        with self._lock:
            index = self._index()
            project_id = index["activeProjectId"]
            by_id = {m["id"]: m for m in index["order"] if m.get("projectId") == project_id}
            ordered = [by_id[i] for i in ids if i in by_id]
            seen = {i for i in ids if i in by_id}
            ordered += [
                m
                for m in index["order"]
                if m.get("projectId") == project_id and m["id"] not in seen
            ]
            others = [m for m in index["order"] if m.get("projectId") != project_id]
            index["order"] = others + ordered
            self._save_index(index)
            _emit("reorder")
            return self._project_view(index)

    # -- manual folders ----------------------------------------------------

    def create_group(self, name: str, parent_id: str | None = None) -> dict:
        with self._lock:
            index = self._index()
            project_id = index["activeProjectId"]
            if parent_id and not any(
                g["id"] == parent_id and g.get("projectId") == project_id for g in index["groups"]
            ):
                raise KeyError(parent_id)
            group = {
                "id": "g-" + uuid.uuid4().hex[:6],
                "name": name or "Ordner",
                "projectId": project_id,
                "parentId": parent_id,
            }
            index["groups"].append(group)
            self._save_index(index)
            _emit("group")
            return self._project_view(index)

    def rename_group(self, group_id: str, name: str) -> dict:
        with self._lock:
            index = self._index()
            for g in index["groups"]:
                if g["id"] == group_id:
                    g["name"] = name
                    break
            self._save_index(index)
            _emit("group")
            return self._project_view(index)

    def delete_group(self, group_id: str) -> dict:
        """Drop the folder and un-group every page that lived in it."""
        with self._lock:
            index = self._index()
            removed = next((g for g in index["groups"] if g["id"] == group_id), None)
            parent_id = removed.get("parentId") if removed else None
            index["groups"] = [g for g in index["groups"] if g["id"] != group_id]
            for g in index["groups"]:
                if g.get("parentId") == group_id:
                    g["parentId"] = parent_id
            for m in index["order"]:
                if m.get("groupId") != group_id:
                    continue
                m["groupId"] = parent_id
                page = self._store.get(self._page_key(m["id"]))
                if page is not None:
                    if parent_id:
                        page["groupId"] = parent_id
                    else:
                        page.pop("groupId", None)
                    self._store.set(self._page_key(m["id"]), page)
            self._save_index(index)
            _emit("group")
            return self._project_view(index)

    def set_page_group(self, page_id: str, group_id: str | None) -> dict:
        """Move a page into a folder (or out of any folder when ``None``)."""
        with self._lock:
            page = self._store.get(self._page_key(page_id))
            if page is None:
                raise KeyError(page_id)
            if group_id and not any(
                g["id"] == group_id and g.get("projectId") == page.get("projectId")
                for g in self._index()["groups"]
            ):
                raise KeyError(group_id)
            if group_id:
                page["groupId"] = group_id
            else:
                page.pop("groupId", None)
            page["revision"] = page.get("revision", 0) + 1
            self._store.set(self._page_key(page_id), page)
            self._refresh_meta(page)
            _emit("group", page_id=page_id)
            return self._project_view(self._index())

    def move_page_to_project(self, page_id: str, target_project_id: str) -> dict:
        with self._lock:
            index = self._index()
            target = next(
                (
                    p
                    for p in index["projects"]
                    if p["id"] == target_project_id and not p.get("archived")
                ),
                None,
            )
            page = self._store.get(self._page_key(page_id))
            if not target or not page or not page.get("id"):
                raise KeyError(page_id)
            old_id = page["projectId"]
            if old_id == target_project_id:
                return self._project_view(index)
            old = next(p for p in index["projects"] if p["id"] == old_id)
            page["projectId"] = target_project_id
            page["groupId"] = None
            page["modified"] = now()
            page["revision"] = page.get("revision", 0) + 1
            self._store.set(self._page_key(page_id), page)
            self._refresh_meta(page)
            index = self._index()
            old = next(p for p in index["projects"] if p["id"] == old_id)
            target = next(p for p in index["projects"] if p["id"] == target_project_id)
            target["activeId"] = page_id
            if old.get("activeId") == page_id:
                old["activeId"] = next(
                    (m["id"] for m in index["order"] if m.get("projectId") == old_id), None
                )
            self._save_index(index)
            if not old.get("activeId"):
                self._create_locked(project_id=old_id)
                index = self._index()
            _emit("project", page_id=page_id)
            return self._project_view(index)

    def projects(self) -> list[dict]:
        with self._lock:
            index = self._index()
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

        with self._lock:
            index = self._index()
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
            self._save_index(index)
            self._create_locked(project_id=project["id"])
            _emit("project")
            return self._project_view(self._index())

    def activate_project(self, project_id: str) -> dict:
        with self._lock:
            index = self._index()
            project = next(
                (p for p in index["projects"] if p["id"] == project_id and not p.get("archived")),
                None,
            )
            if not project:
                raise KeyError(project_id)
            index["activeProjectId"] = project_id
            self._save_index(index)
            if not project.get("activeId"):
                self._create_locked(project_id=project_id)
                index = self._index()
            _emit("project")
            return self._project_view(index)

    def update_project(
        self,
        project_id: str,
        *,
        name: str | None = None,
        archived: bool | None = None,
        profile_id: str | None = None,
    ) -> dict:
        with self._lock:
            index = self._index()
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
            self._save_index(index)
            _emit("project")
            return project

    def set_group_parent(self, group_id: str, parent_id: str | None) -> dict:
        with self._lock:
            index = self._index()
            group = next((g for g in index["groups"] if g["id"] == group_id), None)
            if not group:
                raise KeyError(group_id)
            if parent_id:
                parent = next((g for g in index["groups"] if g["id"] == parent_id), None)
                if not parent or parent.get("projectId") != group.get("projectId"):
                    raise KeyError(parent_id)
                cursor = parent
                while cursor:
                    if cursor["id"] == group_id:
                        raise ValueError("Ordner können nicht in sich selbst verschoben werden.")
                    cursor = next(
                        (g for g in index["groups"] if g["id"] == cursor.get("parentId")), None
                    )
            group["parentId"] = parent_id
            self._save_index(index)
            _emit("group")
            return self._project_view(index)

    # -- internal ----------------------------------------------------------

    def _refresh_meta(self, page: dict) -> None:
        index = self._index()
        meta = self._meta(page)
        for i, m in enumerate(index["order"]):
            if m["id"] == page["id"]:
                index["order"][i] = meta
                break
        for project in index["projects"]:
            if project["id"] == page.get("projectId"):
                project["modified"] = page.get("modified", now())
                break
        self._save_index(index)


_doc: DocumentStore | None = None
_doc_lock = threading.Lock()


def get_document_store() -> DocumentStore:
    global _doc
    with _doc_lock:
        if _doc is None:
            _doc = DocumentStore(create_store())
        return _doc
