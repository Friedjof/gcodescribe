from __future__ import annotations

import threading
import time
import uuid

from .state import StateStore, create_store

# Default grid: five granularity levels in mm (coarse -> fine).
GRID_STEPS = [50, 25, 10, 5, 1]
DEFAULT_GRID = {"step": 10, "snap": False}


def _now() -> float:
    return time.time()


def _new_id() -> str:
    return "p-" + uuid.uuid4().hex[:6]


def _page_thumbnail(page: dict) -> dict | None:
    """Compact sidebar preview; tolerant so the store keeps working even if
    the scene/geometry layer is unavailable."""
    try:
        from .scene import page_thumbnail

        return page_thumbnail(page)
    except Exception:
        return None


def _active_profile_meta() -> dict | None:
    """Active profile for new pages; tolerant so the paint store keeps
    working even if the profile layer is unavailable."""
    try:
        from .services.profiles import ProfileService

        return ProfileService().active_profile_meta()
    except Exception:
        return None


class DocumentStore:
    """Multi-page paint document, persisted in the state store (Redis/file).

    Layout in the store:
      ``paint_index`` -> {"order": [meta, ...], "activeId": id}
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
        return self._store.get(self.INDEX_KEY) or {"order": [], "activeId": None}

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
            "thumb": _page_thumbnail(page),
            # Profile the page was created for. Old pages have no profile
            # fields; they are reported as "missing" and must be adopted
            # explicitly (never silently bound to the active profile).
            "profileId": page.get("profileId"),
            "profileName": page.get("profileName"),
            "profileFingerprint": page.get("profileFingerprint"),
        }

    def _page_key(self, page_id: str) -> str:
        return f"paint_page_{page_id}"

    # -- queries -----------------------------------------------------------

    def list_pages(self) -> dict:
        """Index document: ordered page metadata + the active page id."""
        with self._lock:
            index = self._index()
            # Ensure there is always at least one page to work on.
            if not index["order"]:
                self._create_locked(profile=_active_profile_meta())
                index = self._index()
            return index

    def get_page(self, page_id: str) -> dict | None:
        with self._lock:
            return self._store.get(self._page_key(page_id))

    # -- mutations ---------------------------------------------------------

    def _create_locked(self, name: str | None = None, profile: dict | None = None) -> dict:
        page_id = _new_id()
        now = _now()
        page = {
            "id": page_id,
            "name": name or page_id,
            "objects": [],
            "grid": dict(DEFAULT_GRID),
            "created": now,
            "modified": now,
        }
        if profile:
            page["profileId"] = profile.get("id")
            page["profileName"] = profile.get("name")
            page["profileFingerprint"] = profile.get("fingerprint")
        self._store.set(self._page_key(page_id), page)
        index = self._index()
        index["order"].append(self._meta(page))
        index["activeId"] = page_id
        self._save_index(index)
        return page

    def create_page(self, name: str | None = None, profile: dict | None = None) -> dict:
        with self._lock:
            return self._create_locked(name, profile)

    def set_page_profile(self, page_id: str, profile: dict) -> dict:
        """Explicitly bind a page to a profile (adopt / re-adopt)."""
        with self._lock:
            page = self._store.get(self._page_key(page_id))
            if page is None:
                raise KeyError(page_id)
            page["profileId"] = profile.get("id")
            page["profileName"] = profile.get("name")
            page["profileFingerprint"] = profile.get("fingerprint")
            page["modified"] = _now()
            self._store.set(self._page_key(page_id), page)
            self._refresh_meta(page)
            return page

    def save_page(self, page_id: str, updates: dict) -> dict:
        """Update a page's objects / grid / name (whatever is provided)."""
        with self._lock:
            page = self._store.get(self._page_key(page_id))
            if page is None:
                raise KeyError(page_id)
            for field in ("objects", "grid", "name", "markdown", "coloring", "continuous"):
                if field in updates and updates[field] is not None:
                    page[field] = updates[field]
            page["modified"] = _now()
            self._store.set(self._page_key(page_id), page)
            self._refresh_meta(page)
            return page

    def rename_page(self, page_id: str, name: str) -> dict:
        return self.save_page(page_id, {"name": name})

    def delete_page(self, page_id: str) -> dict:
        with self._lock:
            index = self._index()
            index["order"] = [m for m in index["order"] if m["id"] != page_id]
            self._store.set(self._page_key(page_id), {})  # tombstone / clear
            if index["activeId"] == page_id:
                index["activeId"] = index["order"][-1]["id"] if index["order"] else None
            self._save_index(index)
            if not index["order"]:
                self._create_locked(profile=_active_profile_meta())
                index = self._index()
            return index

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
            )
            copy["objects"] = src.get("objects", [])
            copy["grid"] = src.get("grid", dict(DEFAULT_GRID))
            if src.get("markdown"):
                copy["markdown"] = src["markdown"]
            copy["modified"] = _now()
            self._store.set(self._page_key(copy["id"]), copy)
            self._refresh_meta(copy)
            return copy

    def set_active(self, page_id: str) -> dict:
        with self._lock:
            index = self._index()
            if any(m["id"] == page_id for m in index["order"]):
                index["activeId"] = page_id
                self._save_index(index)
            return index

    def reorder_pages(self, ids: list[str]) -> dict:
        """Reorder the page list to match ``ids``.

        Only known ids are honoured; any pages missing from ``ids`` keep their
        relative order and are appended after the requested ones, so a partial
        or stale list can never drop pages.
        """
        with self._lock:
            index = self._index()
            by_id = {m["id"]: m for m in index["order"]}
            ordered = [by_id[i] for i in ids if i in by_id]
            seen = {i for i in ids if i in by_id}
            ordered += [m for m in index["order"] if m["id"] not in seen]
            index["order"] = ordered
            self._save_index(index)
            return index

    # -- internal ----------------------------------------------------------

    def _refresh_meta(self, page: dict) -> None:
        index = self._index()
        meta = self._meta(page)
        for i, m in enumerate(index["order"]):
            if m["id"] == page["id"]:
                index["order"][i] = meta
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
