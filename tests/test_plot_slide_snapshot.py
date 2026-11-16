from __future__ import annotations

import json

import pytest

from scripts.snapshot_plot_slides import (
    SnapshotChanged,
    file_snapshot,
    redis_snapshot,
    write_snapshot,
)


def test_file_capture_only_reads_slide_and_profile_files(tmp_path):
    (tmp_path / "state").mkdir()
    (tmp_path / "profiles").mkdir()
    (tmp_path / "state" / "paint_index.json").write_text('{"order": []}')
    (tmp_path / "state" / "paint_page_deleted.json").write_text("{}")
    (tmp_path / "state" / "auth_session_private.json").write_text('"not a slide"')
    (tmp_path / "profiles" / "p.json").write_text('{"id": "p", "calibration": {}}')
    captured = file_snapshot(tmp_path)
    assert set(captured) == {
        "state/paint_index.json", "state/paint_page_deleted.json", "profiles/p.json",
    }
    assert (tmp_path / "state" / "paint_index.json").read_text() == '{"order": []}'


def test_file_snapshot_rejects_concurrent_mutation(tmp_path, monkeypatch):
    from scripts import snapshot_plot_slides as module
    responses = iter([{"a": b"1"}, {"a": b"2"}])
    monkeypatch.setattr(module, "read_files", lambda *_args, **_kwargs: next(responses))
    with pytest.raises(SnapshotChanged, match="changed"):
        file_snapshot(tmp_path)


class ReadOnlyRedis:
    def __init__(self, *, change_index=False, change_keys=False):
        self.index = b'{"order":[{"id":"p"}]}'
        self.page = b'{"id":"p","objects":[]}'
        self.change_index = change_index
        self.change_keys = change_keys
        self.scans = 0

    def scan_iter(self, *, match):
        assert match == "plotter:paint_page_*"
        self.scans += 1
        keys = [b"plotter:paint_page_p"]
        return keys + ([b"plotter:paint_page_new"] if self.change_keys and self.scans > 1 else [])

    def mget(self, keys):
        assert keys == [b"plotter:paint_index", b"plotter:paint_page_p"]
        return [self.index, self.page]

    def get(self, key):
        assert key == b"plotter:paint_index"
        return b"{}" if self.change_index else self.index


def test_redis_capture_uses_only_scoped_reads_and_includes_profiles(tmp_path):
    (tmp_path / "profiles").mkdir()
    (tmp_path / "profiles" / "p.json").write_text('{"id":"p","calibration":{}}')
    captured = redis_snapshot(ReadOnlyRedis(), tmp_path)
    assert set(captured) == {"profiles/p.json", "state/paint_index.json", "state/paint_page_p.json"}


@pytest.mark.parametrize("change", ["change_keys", "change_index"])
def test_redis_capture_rejects_inconsistent_key_or_index_snapshot(tmp_path, change):
    with pytest.raises(SnapshotChanged):
        redis_snapshot(ReadOnlyRedis(**{change: True}), tmp_path)


def test_output_is_new_private_and_hash_manifest_matches(tmp_path):
    destination = tmp_path / "capture"
    raw = b'{"order":[]}'
    manifest = write_snapshot(destination, {"test": {"state/paint_index.json": raw}})
    assert manifest["complete"]
    assert destination.stat().st_mode & 0o777 == 0o700
    assert not (destination / ".incomplete").exists()
    assert json.loads((destination / "manifest.json").read_text()) == manifest
    with pytest.raises(FileExistsError):
        write_snapshot(destination, {"test": {"state/paint_index.json": raw}})


@pytest.mark.parametrize("source", [
    {"../outside": {"state/paint_index.json": b"{}"}},
    {"ok": {"state/../../outside.json": b"{}"}},
    {"ok": {"state/paint_index.json": b"broken"}},
])
def test_unsafe_or_invalid_snapshot_never_creates_output(tmp_path, source):
    destination = tmp_path / "capture"
    with pytest.raises(ValueError):
        write_snapshot(destination, source)
    assert not destination.exists()
