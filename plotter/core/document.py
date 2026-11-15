"""Stable document API; domain repositories share one persistence context."""

from __future__ import annotations

import threading

from plotter.core.state import StateStore, create_store

from .documents.common import DEFAULT_GRID as DEFAULT_GRID
from .documents.common import GRID_STEPS as GRID_STEPS
from .documents.common import RevisionConflict as RevisionConflict
from .documents.folders import FolderRepository
from .documents.pages import PageRepository
from .documents.projects import ProjectRepository
from .documents.state import DocumentState


class DocumentStore:
    """Project and slide store with one lock across page, project and folder writes."""

    INDEX_KEY = DocumentState.INDEX_KEY

    def __init__(self, store: StateStore):
        data = DocumentState(store)
        self._pages = PageRepository(data)
        self._projects = ProjectRepository(data, self._pages)
        self._folders = FolderRepository(data)

    def list_pages(self) -> dict:
        """Index document: ordered page metadata + the active page id."""
        return self._pages.list_pages()

    def get_page(self, page_id: str) -> dict | None:
        return self._pages.get_page(page_id)

    def get_thumbnail(self, page_id: str) -> dict | None:
        """Build a small drawing preview on demand, never during index updates."""
        return self._pages.get_thumbnail(page_id)

    def create_page(
        self,
        name: str | None = None,
        profile: dict | None = None,
        mcp: dict | None = None,
        project_id: str | None = None,
        folder_id: str | None = None,
    ) -> dict:
        return self._pages.create_page(name, profile, mcp, project_id, folder_id)

    def set_page_profile(self, page_id: str, profile: dict) -> dict:
        """Explicitly bind a page to a profile (adopt / re-adopt)."""
        return self._pages.set_page_profile(page_id, profile)

    def save_page(self, page_id: str, updates: dict) -> dict:
        """Update a page's objects / grid / name (whatever is provided)."""
        return self._pages.save_page(page_id, updates)

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
        return self._pages.patch_objects(
            page_id, revision=revision, mutation_id=mutation_id, changes=changes, removed=removed
        )

    def rename_page(self, page_id: str, name: str) -> dict:
        return self._pages.rename_page(page_id, name)

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
        return self._pages.append_import(
            page_id, profile_id, fingerprint, task_id, obj, project_id=project_id
        )

    def delete_page(self, page_id: str) -> dict:
        return self._pages.delete_page(page_id)

    def duplicate_page(self, page_id: str) -> dict:
        return self._pages.duplicate_page(page_id)

    def set_active(self, page_id: str) -> dict:
        return self._pages.set_active(page_id)

    def reorder_pages(self, ids: list[str]) -> dict:
        """Reorder the page list to match ``ids``.

        Only known ids are honoured; any pages missing from ``ids`` keep their
        relative order and are appended after the requested ones, so a partial
        or stale list can never drop pages."""
        return self._pages.reorder_pages(ids)

    def move_page_to_project(self, page_id: str, target_project_id: str) -> dict:
        return self._pages.move_page_to_project(page_id, target_project_id)

    def projects(self) -> list[dict]:
        return self._projects.projects()

    def create_project(
        self, name: str, template_profile_id: str | None = None, *, profile_id: str | None = None
    ) -> dict:
        return self._projects.create_project(name, template_profile_id, profile_id=profile_id)

    def activate_project(self, project_id: str) -> dict:
        return self._projects.activate_project(project_id)

    def update_project(
        self,
        project_id: str,
        *,
        name: str | None = None,
        archived: bool | None = None,
        profile_id: str | None = None,
    ) -> dict:
        return self._projects.update_project(
            project_id, name=name, archived=archived, profile_id=profile_id
        )

    def create_group(self, name: str, parent_id: str | None = None) -> dict:
        return self._folders.create_group(name, parent_id)

    def rename_group(self, group_id: str, name: str) -> dict:
        return self._folders.rename_group(group_id, name)

    def delete_group(self, group_id: str) -> dict:
        """Drop the folder and un-group every page that lived in it."""
        return self._folders.delete_group(group_id)

    def set_page_group(self, page_id: str, group_id: str | None) -> dict:
        """Move a page into a folder (or out of any folder when ``None``)."""
        return self._folders.set_page_group(page_id, group_id)

    def set_group_parent(self, group_id: str, parent_id: str | None) -> dict:
        return self._folders.set_group_parent(group_id, parent_id)


_doc: DocumentStore | None = None
_doc_lock = threading.Lock()


def get_document_store() -> DocumentStore:
    global _doc
    with _doc_lock:
        if _doc is None:
            _doc = DocumentStore(create_store())
        return _doc
