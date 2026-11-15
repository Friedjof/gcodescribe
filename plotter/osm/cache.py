"""Small disk cache of complete road downloads, independent of plot settings."""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
import time
from contextlib import suppress
from pathlib import Path

from plotter.core.calibration import data_dir

from .types import BBox

CACHE_TTL_SECONDS = 24 * 60 * 60
MAX_CACHE_FILES = 24


def _path(bbox: BBox, area_id: int | None, selector: str) -> Path:
    key = json.dumps([1, bbox.south, bbox.west, bbox.north, bbox.east, area_id, selector])
    return data_dir() / "osm-cache" / f"{hashlib.sha256(key.encode()).hexdigest()}.json.gz"


def read_roads(bbox: BBox, area_id: int | None, selector: str) -> dict | None:
    try:
        path = _path(bbox, area_id, selector)
        if time.time() - path.stat().st_mtime > CACHE_TTL_SECONDS:
            return None
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            data = json.load(stream)
        if (
            isinstance(data, dict)
            and isinstance(data.get("elements"), list)
            and not data.get("remark")
        ):
            return data
    except (OSError, EOFError, ValueError):
        pass  # A missing/unwritable/corrupt cache must not prevent a fresh download.
    return None


def write_roads(bbox: BBox, area_id: int | None, selector: str, data: dict) -> None:
    if not isinstance(data.get("elements"), list) or data.get("remark"):
        return
    temporary: Path | None = None
    try:
        path = _path(bbox, area_id, selector)
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
        with gzip.open(temporary, "wt", encoding="utf-8", compresslevel=1) as stream:
            json.dump(data, stream, separators=(",", ":"))
        os.replace(temporary, path)
        files = sorted(path.parent.glob("*.json.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[MAX_CACHE_FILES:]:
            old.unlink(missing_ok=True)
    except OSError:
        pass  # Caching is optional (e.g. on a read-only data volume).
    finally:
        if temporary is not None:
            with suppress(OSError):
                temporary.unlink(missing_ok=True)
