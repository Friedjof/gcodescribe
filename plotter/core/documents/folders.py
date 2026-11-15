from __future__ import annotations

import uuid

from .common import _emit
from .state import DocumentState


class FolderRepository:
    def __init__(self, data: DocumentState):
        self.data = data

    def create_group(self, name: str, parent_id: str | None = None) -> dict:
        with self.data.lock:
            index = self.data.index()
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
            self.data.save_index(index)
            _emit("group")
            return self.data.project_view(index)

    def rename_group(self, group_id: str, name: str) -> dict:
        with self.data.lock:
            index = self.data.index()
            for g in index["groups"]:
                if g["id"] == group_id:
                    g["name"] = name
                    break
            self.data.save_index(index)
            _emit("group")
            return self.data.project_view(index)

    def delete_group(self, group_id: str) -> dict:
        """Drop the folder and un-group every page that lived in it."""
        with self.data.lock:
            index = self.data.index()
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
                page = self.data.store.get(self.data.page_key(m["id"]))
                if page is not None:
                    if parent_id:
                        page["groupId"] = parent_id
                    else:
                        page.pop("groupId", None)
                    self.data.store.set(self.data.page_key(m["id"]), page)
            self.data.save_index(index)
            _emit("group")
            return self.data.project_view(index)

    def set_page_group(self, page_id: str, group_id: str | None) -> dict:
        """Move a page into a folder (or out of any folder when ``None``)."""
        with self.data.lock:
            page = self.data.read_page(page_id)
            if page is None:
                raise KeyError(page_id)
            if group_id and not any(
                g["id"] == group_id and g.get("projectId") == page.get("projectId")
                for g in self.data.index()["groups"]
            ):
                raise KeyError(group_id)
            if group_id:
                page["groupId"] = group_id
            else:
                page.pop("groupId", None)
            page["revision"] = page.get("revision", 0) + 1
            self.data.store.set(self.data.page_key(page_id), page)
            self.data.refresh_meta(page)
            _emit("group", page_id=page_id)
            return self.data.project_view(self.data.index())

    def set_group_parent(self, group_id: str, parent_id: str | None) -> dict:
        with self.data.lock:
            index = self.data.index()
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
            self.data.save_index(index)
            _emit("group")
            return self.data.project_view(index)
