from __future__ import annotations

import json

import pytest

from plotter.calibration import Calibration
from plotter.services.profiles import (
    FINGERPRINT_FIELDS,
    ProfileConflict,
    ProfileImportError,
    ProfileNotFound,
    ProfileService,
    calibration_fingerprint,
)


@pytest.fixture
def service(workspace) -> ProfileService:
    return ProfileService()


class TestMigration:
    def test_legacy_calibration_becomes_default_profile(self, workspace):
        Calibration(plot_width=123.0, origin_x=11.0).path().write_text(
            json.dumps(Calibration(plot_width=123.0, origin_x=11.0).as_dict())
        )
        svc = ProfileService()
        profiles = svc.list()
        assert len(profiles) == 1
        active = svc.active()
        assert active["active"] is True
        assert active["calibration"]["plot_width"] == 123.0
        assert active["calibration"]["origin_x"] == 11.0
        # The legacy file is backed up, not deleted.
        assert (workspace / "calibration.json.pre-profiles.bak").exists()
        assert (workspace / "calibration.json").exists()

    def test_empty_data_dir_creates_default_profile(self, service):
        profiles = service.list()
        assert len(profiles) == 1
        assert profiles[0]["active"] is True
        assert service.active()["calibration"] == Calibration().as_dict()

    def test_migration_is_idempotent(self, service):
        service.ensure_migrated()
        service.ensure_migrated()
        assert len(service.list()) == 1

    def test_active_calibration_matches_calibration_load(self, service, workspace):
        active = service.active_calibration()
        assert active.as_dict() == Calibration.load().as_dict()


class TestCrud:
    def test_create_copies_active_calibration(self, service):
        service.update(service.active_id(), calibration={"plot_width": 99.0})
        created = service.create("Postkarte")
        assert created["name"] == "Postkarte"
        assert created["calibration"]["plot_width"] == 99.0
        assert created["active"] is False

    def test_create_deduplicates_names(self, service):
        a = service.create("Postkarte")
        b = service.create("Postkarte")
        assert a["name"] == "Postkarte"
        assert b["name"] == "Postkarte (2)"

    def test_update_calibration_changes_fingerprint(self, service):
        profile = service.create("P")
        updated = service.update(profile["id"], calibration={"pen_down_z": 2.5})
        assert updated["fingerprint"] != profile["fingerprint"]

    def test_rename_keeps_fingerprint(self, service):
        profile = service.create("P")
        updated = service.update(profile["id"], name="Anders")
        assert updated["name"] == "Anders"
        assert updated["fingerprint"] == profile["fingerprint"]

    def test_duplicate_copies_calibration(self, service):
        src = service.update(service.active_id(), calibration={"plot_width": 77.0})
        copy = service.duplicate(src["id"])
        assert copy["name"].startswith(src["name"])
        assert copy["calibration"]["plot_width"] == 77.0
        assert copy["id"] != src["id"]
        assert copy["fingerprint"] == src["fingerprint"]

    def test_get_unknown_profile_raises(self, service):
        with pytest.raises(ProfileNotFound):
            service.get("prof-doesnotexist")


class TestActivation:
    def test_activate_switches_mirror(self, service):
        other = service.create("Postkarte", calibration={"plot_width": 148.0, "plot_height": 105.0})
        service.activate(other["id"])
        assert service.active_id() == other["id"]
        # Legacy callers see the new active profile via Calibration.load().
        assert Calibration.load().plot_width == 148.0

    def test_archive_active_is_blocked(self, service):
        with pytest.raises(ProfileConflict):
            service.archive(service.active_id())

    def test_activate_archived_is_blocked(self, service):
        other = service.create("P")
        service.archive(other["id"])
        with pytest.raises(ProfileConflict):
            service.activate(other["id"])
        service.unarchive(other["id"])
        assert service.activate(other["id"])["active"] is True

    def test_calibration_save_syncs_active_profile(self, service):
        cal = Calibration.load().merged({"pen_down_z": 3.3})
        before = service.active()["fingerprint"]
        cal.save()
        active = service.active()
        assert active["calibration"]["pen_down_z"] == 3.3
        assert active["fingerprint"] != before


class TestFingerprint:
    def test_stable_for_equal_values(self):
        a = Calibration(plot_width=100.0)
        b = Calibration(plot_width=100.0)
        assert calibration_fingerprint(a) == calibration_fingerprint(b)

    @pytest.mark.parametrize("field", FINGERPRINT_FIELDS)
    def test_every_safety_field_changes_fingerprint(self, field):
        base = Calibration().as_dict()
        changed = dict(base)
        value = base[field]
        if isinstance(value, bool):
            changed[field] = not value
        elif isinstance(value, (int, float)):
            changed[field] = float(value) + 1.5
        elif isinstance(value, dict):
            changed[field] = {"bl": [1.0, 2.0]}
        else:  # pragma: no cover - defensive
            raise AssertionError(f"unhandled field type: {field}")
        assert calibration_fingerprint(base) != calibration_fingerprint(changed)


class TestImportExport:
    def test_single_profile_roundtrip(self, service):
        src = service.create("Postkarte", calibration={"plot_width": 148.0})
        payload = service.export_profile(src["id"])
        assert payload["format"] == "gcodescribe-profile"
        imported = service.import_profile(payload)
        assert imported["id"] != src["id"]
        assert imported["name"] == "Postkarte (2)"
        assert imported["fingerprint"] == src["fingerprint"]

    def test_import_never_activates(self, service):
        active_before = service.active_id()
        service.import_profile(service.export_profile(active_before))
        assert service.active_id() == active_before

    def test_bundle_roundtrip(self, service):
        service.create("A")
        service.create("B")
        bundle = service.export_bundle()
        assert bundle["format"] == "gcodescribe-profile-bundle"
        assert len(bundle["profiles"]) == 3
        report = service.import_bundle(bundle)
        assert len(report["imported"]) == 3
        assert len(service.list()) == 6

    def test_bundle_replace_overwrites_same_ids(self, service):
        bundle = service.export_bundle()
        bundle["profiles"][0]["calibration"]["plot_width"] = 42.0
        report = service.import_bundle(bundle, replace=True)
        assert len(report["replaced"]) == 1
        assert not report["imported"]
        assert service.active()["calibration"]["plot_width"] == 42.0

    def test_invalid_payload_rejected(self, service):
        with pytest.raises(ProfileImportError):
            service.import_profile({"format": "nonsense"})
        with pytest.raises(ProfileImportError):
            service.import_bundle(
                {"format": "gcodescribe-profile-bundle", "version": 99, "profiles": []}
            )
