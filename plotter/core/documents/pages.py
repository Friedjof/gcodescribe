from __future__ import annotations

from plotter.core.jsonstore import new_id, now

from .common import DEFAULT_GRID, RevisionConflict, _emit, _profile_snapshot
from .state import DocumentState


class PageRepository:
    def __init__(self, data: DocumentState):
        self.data = data

    def list_pages(self) -> dict:
        """Index document: ordered page metadata + the active page id."""
        with self.data.lock:
            index = self.data.index()
            # Ensure there is always at least one page to work on.
            if not any(m.get("projectId") == index["activeProjectId"] for m in index["order"]):
                self._create_locked(project_id=index["activeProjectId"])
                index = self.data.index()
            return self.data.project_view(index)

    def get_page(self, page_id: str) -> dict | None:
        with self.data.lock:
            return self.data.read_page(page_id)

    def get_thumbnail(self, page_id: str) -> dict | None:
        """Build a small drawing preview on demand, never during index updates."""
        with self.data.lock:
            page = self.data.read_page(page_id)
            if not page or not page.get("id"):
                return None
            key = f"paint_thumb_{page_id}"
            cached = self.data.store.get(key)
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
            self.data.store.set(key, result)
            return result

    def _create_locked(
        self,
        name: str | None = None,
        profile: dict | None = None,
        mcp: dict | None = None,
        project_id: str | None = None,
        folder_id: str | None = None,
    ) -> dict:
        index = self.data.index()
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
        self.data.store.set(self.data.page_key(page_id), page)
        index["order"].append(self.data.meta(page))
        index["activeId"] = page_id
        project["activeId"] = page_id
        project["modified"] = ts
        self.data.save_index(index)
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
        with self.data.lock:
            return self._create_locked(name, profile, mcp, project_id, folder_id)

    def set_page_profile(self, page_id: str, profile: dict) -> dict:
        """Explicitly bind a page to a profile (adopt / re-adopt)."""
        with self.data.lock:
            page = self.data.read_page(page_id)
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
            self.data.store.set(self.data.page_key(page_id), page)
            self.data.refresh_meta(page)
            _emit("save", page_id=page_id)
            return page

    def save_page(self, page_id: str, updates: dict) -> dict:
        """Update a page's objects / grid / name (whatever is provided)."""
        with self.data.lock:
            page = self.data.read_page(page_id)
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
            self.data.store.set(self.data.page_key(page_id), page)
            self.data.refresh_meta(page)
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
        with self.data.lock:
            page = self.data.read_page(page_id)
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
            self.data.store.set(self.data.page_key(page_id), page)
            self.data.refresh_meta(page)
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
        with self.data.lock:
            page = self.get_page(page_id)
            if page is None:
                return False
            applied = page.get("_imports", [])
            if task_id in applied:
                return True
            project = next(
                (p for p in self.data.index()["projects"] if p["id"] == page.get("projectId")), None
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
            self.data.store.set(self.data.page_key(page_id), page)
            self.data.refresh_meta(page)
            _emit("import", page_id=page_id)
            return True

    def delete_page(self, page_id: str) -> dict:
        with self.data.lock:
            index = self.data.index()
            deleted = self.data.read_page(page_id)
            index["order"] = [m for m in index["order"] if m["id"] != page_id]
            self.data.store.set(self.data.page_key(page_id), {})  # tombstone / clear
            if index["activeId"] == page_id:
                index["activeId"] = index["order"][-1]["id"] if index["order"] else None
            project = next(
                (p for p in index["projects"] if p["id"] == (deleted or {}).get("projectId")), None
            )
            if project and project.get("activeId") == page_id:
                project["activeId"] = next(
                    (m["id"] for m in index["order"] if m.get("projectId") == project["id"]), None
                )
            self.data.save_index(index)
            if project and not project.get("activeId"):
                self._create_locked(project_id=project["id"])
                index = self.data.index()
            _emit("delete", page_id=page_id)
            return self.data.project_view(index)

    def duplicate_page(self, page_id: str) -> dict:
        with self.data.lock:
            src = self.data.read_page(page_id)
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
            self.data.store.set(self.data.page_key(copy["id"]), copy)
            self.data.refresh_meta(copy)
            _emit("save", page_id=copy["id"])
            return copy

    def set_active(self, page_id: str) -> dict:
        with self.data.lock:
            index = self.data.index()
            if any(m["id"] == page_id for m in index["order"]):
                index["activeId"] = page_id
                project_id = next(m["projectId"] for m in index["order"] if m["id"] == page_id)
                index["activeProjectId"] = project_id
                next(p for p in index["projects"] if p["id"] == project_id)["activeId"] = page_id
                self.data.save_index(index)
                _emit("active", page_id=page_id)
            return self.data.project_view(index)

    def reorder_pages(self, ids: list[str]) -> dict:
        """Reorder the page list to match ``ids``.

        Only known ids are honoured; any pages missing from ``ids`` keep their
        relative order and are appended after the requested ones, so a partial
        or stale list can never drop pages.
        """
        with self.data.lock:
            index = self.data.index()
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
            self.data.save_index(index)
            _emit("reorder")
            return self.data.project_view(index)

    def move_page_to_project(self, page_id: str, target_project_id: str) -> dict:
        with self.data.lock:
            index = self.data.index()
            target = next(
                (
                    p
                    for p in index["projects"]
                    if p["id"] == target_project_id and not p.get("archived")
                ),
                None,
            )
            page = self.data.read_page(page_id)
            if not target or not page or not page.get("id"):
                raise KeyError(page_id)
            old_id = page["projectId"]
            if old_id == target_project_id:
                return self.data.project_view(index)
            old = next(p for p in index["projects"] if p["id"] == old_id)
            page["projectId"] = target_project_id
            page["groupId"] = None
            page["modified"] = now()
            page["revision"] = page.get("revision", 0) + 1
            self.data.store.set(self.data.page_key(page_id), page)
            self.data.refresh_meta(page)
            index = self.data.index()
            old = next(p for p in index["projects"] if p["id"] == old_id)
            target = next(p for p in index["projects"] if p["id"] == target_project_id)
            target["activeId"] = page_id
            if old.get("activeId") == page_id:
                old["activeId"] = next(
                    (m["id"] for m in index["order"] if m.get("projectId") == old_id), None
                )
            self.data.save_index(index)
            if not old.get("activeId"):
                self._create_locked(project_id=old_id)
                index = self.data.index()
            _emit("project", page_id=page_id)
            return self.data.project_view(index)
