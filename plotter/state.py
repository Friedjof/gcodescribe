from __future__ import annotations

import json
import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path

from .calibration import data_dir

log = logging.getLogger(__name__)


class StateStore(ABC):
    """Persistent key/value store for small runtime state (JSON documents).

    Used for everything that must survive an application restart but is not
    user configuration — most importantly the tracked head position.
    """

    @abstractmethod
    def get(self, key: str) -> dict | None: ...

    @abstractmethod
    def set(self, key: str, value: dict) -> None: ...

    @abstractmethod
    def describe(self) -> str: ...


class RedisStateStore(StateStore):
    """State in Redis (``REDIS_URL``). Raises on init if unreachable."""

    PREFIX = "plotter:"

    def __init__(self, url: str):
        import redis

        self._url = url
        self._redis = redis.Redis.from_url(
            url, socket_connect_timeout=2, socket_timeout=2
        )
        self._redis.ping()

    def get(self, key: str) -> dict | None:
        raw = self._redis.get(self.PREFIX + key)
        return json.loads(raw) if raw else None

    def set(self, key: str, value: dict) -> None:
        self._redis.set(self.PREFIX + key, json.dumps(value))

    def describe(self) -> str:
        return f"redis ({self._url})"


class FileStateStore(StateStore):
    """Fallback: one JSON file per key under ``<data>/state/``."""

    def __init__(self, directory: Path | None = None):
        self._dir = directory or (data_dir() / "state")
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self._dir / f"{key}.json"

    def get(self, key: str) -> dict | None:
        path = self._path(key)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return None

    def set(self, key: str, value: dict) -> None:
        tmp = self._path(key).with_suffix(".tmp")
        tmp.write_text(json.dumps(value))
        tmp.replace(self._path(key))

    def describe(self) -> str:
        return f"file ({self._dir})"


def create_store() -> StateStore:
    """Redis if reachable, otherwise the (equally persistent) file store."""
    url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    try:
        store: StateStore = RedisStateStore(url)
    except Exception as exc:  # redis missing / unreachable
        store = FileStateStore()
        log.warning("Redis not available (%s) — falling back to %s", exc, store.describe())
    else:
        log.info("State store: %s", store.describe())
    return store
