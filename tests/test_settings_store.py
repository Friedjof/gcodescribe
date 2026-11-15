from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from plotter.services import settings_store as store


def test_concurrent_patches_and_resets_preserve_unrelated_settings(workspace, monkeypatch):
    store.patch_saved({"printer.serial_port": "old", "future.unknown": [1, 2]})
    write = store._write

    def slow_write(saved):
        # Force overlapping read-modify-write attempts from request threads.
        time.sleep(0.01)
        write(saved)

    monkeypatch.setattr(store, "_write", slow_write)
    barrier = threading.Barrier(9)

    def update(index):
        barrier.wait(timeout=3)
        if index == 8:
            store.clear_field("printer", "serial_port")
        else:
            store.patch_saved({f"future.field{index}": index})

    with ThreadPoolExecutor(max_workers=9) as pool:
        list(pool.map(update, range(9)))
    assert store.load_saved() == {
        "future.unknown": [1, 2],
        **{f"future.field{i}": i for i in range(8)},
    }


def test_failed_atomic_replace_keeps_previous_settings(workspace, monkeypatch):
    original = {"printer.serial_port": "original", "ai.api_key": "test-secret"}
    store.patch_saved(original)

    def fail_replace(source, target):
        # A concurrent reader still sees the complete old version, even after
        # the new file has been fully written and before it can be committed.
        assert json.loads(Path(target).read_text()) == original
        raise OSError("disk failure")

    monkeypatch.setattr(Path, "replace", fail_replace)
    with pytest.raises(OSError, match="disk failure"):
        store.patch_saved({"printer.serial_port": "replacement"})
    assert store.load_saved() == original


def test_read_only_flags_are_not_persisted_but_unknown_fields_survive(workspace):
    assert store.patch_saved(
        {
            "gallery.upload_secret_configured": True,
            "printer.octoprint_api_key_configured": True,
            "future.connection": {"mode": "test"},
        }
    ) == {
        "future.connection": {"mode": "test"},
    }


@pytest.mark.parametrize("payload", [[], 42, {"active": []}, {"active": 7}, "invalid"])
def test_invalid_saved_backend_selection_is_ignored(workspace, payload):
    (workspace / "printer_backend.json").write_text(json.dumps(payload))
    assert store.load_active_backend() is None
