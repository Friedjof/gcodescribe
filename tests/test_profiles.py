from __future__ import annotations

import json

import pytest

from plotter.core.calibration import Calibration
from plotter.services.profiles import (
    FINGERPRINT_FIELDS,
    ProfileConflict,
    ProfileError,
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
    def test_pressure_depth_updates_profile_and_roundtrips_xml(self, service):
        from plotter.artwork.export import calibration_from_xml, calibration_to_xml
        from plotter.core.calibration import same_plot_layout, slide_calibration_differences

        profile = service.create("Pressure", calibration={"pen_down_z": 3})
        updated = service.update(profile["id"], calibration={"pen_pressure_max_depth": 0.4})
        assert updated["calibration"]["pen_pressure_max_depth"] == 0.4
        assert updated["fingerprint"] != profile["fingerprint"]
        saved = Calibration.from_dict(updated["calibration"])
        assert calibration_from_xml(calibration_to_xml(saved)).pen_pressure_max_depth == 0.4
        previous = Calibration.from_dict(profile["calibration"])
        assert not same_plot_layout(previous, saved)
        assert "Maximale Zusatzabsenkung" in slide_calibration_differences(previous, saved)

    @pytest.mark.parametrize("depth", [-0.1, float("nan"), float("inf"), 3.1])
    def test_rejects_invalid_pressure_depth_without_changing_profile(self, service, depth):
        profile = service.create("Pressure", calibration={"pen_down_z": 3})
        with pytest.raises(ProfileError, match="Zusatzabsenkung"):
            service.update(profile["id"], calibration={"pen_pressure_max_depth": depth})
        assert service.get(profile["id"])["fingerprint"] == profile["fingerprint"]

    def test_recalibration_cannot_move_pressure_below_machine_zero(self, service):
        profile = service.create(
            "Pressure",
            calibration={
                "pen_down_z": 3,
                "pen_pressure_max_depth": 0.4,
            },
        )
        with pytest.raises(ProfileError, match="Maschinen-Z 0"):
            service.update(profile["id"], calibration={"pen_down_z": 0.2})

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


class TestParkDefaults:
    """Legacy profiles/dicts lack park_x/park_y/park_lift_z; the default must
    resolve against *that data's own* bed size / pen-up height, not the
    default Calibration() instance's."""

    def test_build_resolves_park_against_own_bed_size(self, service):
        legacy = Calibration(bed_width=300.0, bed_height=400.0, pen_up_z=12.0).as_dict()
        del legacy["park_x"], legacy["park_y"], legacy["park_lift_z"]
        created = service.create("Legacy", calibration=legacy)
        assert created["calibration"]["park_x"] == 150.0
        assert created["calibration"]["park_y"] == 400.0
        assert created["calibration"]["park_lift_z"] == 12.0

    def test_update_resolves_park_against_own_bed_size(self, service):
        legacy = Calibration(bed_width=300.0, bed_height=400.0, pen_up_z=12.0).as_dict()
        del legacy["park_x"], legacy["park_y"], legacy["park_lift_z"]
        created = service.create("Legacy", calibration=legacy)
        updated = service.update(created["id"], calibration={"pen_down_z": 0.5})
        assert updated["calibration"]["park_x"] == 150.0
        assert updated["calibration"]["park_y"] == 400.0
        assert updated["calibration"]["park_lift_z"] == 12.0

    def test_active_calibration_resolves_park_against_own_bed_size(self, service):
        legacy = Calibration(bed_width=300.0, bed_height=400.0, pen_up_z=12.0).as_dict()
        del legacy["park_x"], legacy["park_y"], legacy["park_lift_z"]
        created = service.create("Legacy", calibration=legacy)
        service.activate(created["id"])
        active = service.active_calibration()
        assert active.resolved_park() == (150.0, 400.0, 12.0)


class TestCalibrationParkDefaults:
    def test_defaults_resolve_from_own_bed_size(self):
        cal = Calibration(bed_width=300.0, bed_height=400.0)
        x, y, _ = cal.resolved_park()
        assert x == 150.0
        assert y == 400.0

    def test_lift_defaults_to_pen_up_z(self):
        cal = Calibration(pen_up_z=12.0)
        assert cal.resolved_park()[2] == 12.0

    def test_explicit_values_are_kept(self):
        cal = Calibration(
            bed_width=300.0, bed_height=400.0, park_x=1.0, park_y=2.0, park_lift_z=3.0
        )
        assert cal.resolved_park() == (1.0, 2.0, 3.0)

    def test_defaults_track_source_fields_until_customised(self):
        # Unset park_lift_z must keep following pen_up_z even after later
        # updates change pen_up_z — it must not freeze at construction time.
        cal = Calibration(pen_up_z=5.0).merged({"pen_up_z": 12.0})
        assert cal.resolved_park()[2] == 12.0
        cal = Calibration(bed_width=210.0).merged({"bed_width": 300.0})
        assert cal.resolved_park()[0] == 150.0


class TestFingerprint:
    def test_stable_for_equal_values(self):
        a = Calibration(plot_width=100.0)
        b = Calibration(plot_width=100.0)
        assert calibration_fingerprint(a) == calibration_fingerprint(b)

    @pytest.mark.parametrize("field", FINGERPRINT_FIELDS)
    def test_every_safety_field_changes_fingerprint(self, field):
        base = Calibration(pen_down_z=3).as_dict()
        changed = dict(base)
        value = base[field]
        if field == "plot_area_base":
            changed[field] = {"x": 10, "y": 20, "w": 100, "h": 120}
        elif isinstance(value, bool):
            changed[field] = not value
        elif isinstance(value, (int, float)):
            changed[field] = float(value) + 1.5
        elif isinstance(value, dict):
            changed[field] = {"bl": [1.0, 2.0]}
        elif isinstance(value, list):
            changed[field] = [{"id": "test", "x": 10.0, "y": 10.0, "w": 20.0, "h": 20.0}]
        else:  # pragma: no cover - defensive
            raise AssertionError(f"unhandled field type: {field}")
        assert calibration_fingerprint(base) != calibration_fingerprint(changed)

    def test_missing_default_fields_match_a_current_calibration(self):
        assert calibration_fingerprint({}) == calibration_fingerprint(Calibration())

    def test_read_upgrades_fingerprint_without_changing_calibration_or_modified(self, service):
        profile = service.active()
        path = service.root / f"{profile['id']}.json"
        before = json.loads(path.read_text())
        before["fingerprint"] = "sha256:old-version"
        before["modified"] = 123.456
        before["calibration"].pop("plot_area_base", None)
        path.write_text(json.dumps(before))
        loaded = service.get(profile["id"])
        after = json.loads(path.read_text())
        assert loaded["fingerprint"] == calibration_fingerprint(before["calibration"])
        assert after == {**before, "fingerprint": loaded["fingerprint"]}
        assert loaded["modified"] == 123.456


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


class TestFeedrateUpgrade:
    def test_legacy_calibration_preserves_physical_speed(self, workspace):
        raw = {"travel_feed": 6000, "draw_feed": 3000, "z_feed": 1000}
        Calibration.path().write_text(json.dumps(raw))
        cal = Calibration.load()
        assert (cal.travel_feed, cal.draw_feed, cal.z_feed) == pytest.approx((100, 50, 1000 / 60))
        cal.save()
        assert Calibration.load().z_feed == pytest.approx(1000 / 60)

    def test_existing_profile_is_backed_up_and_migrated_once(self, service):
        profile = service.active()
        path = service._profile_path(profile["id"])
        raw = json.loads(path.read_text())
        raw["calibration"].pop("z_max_feedrate")
        raw["calibration"].update(travel_feed=6000, draw_feed=3000, z_feed=1000)
        path.write_text(json.dumps(raw))
        assert service.get(profile["id"])["calibration"]["travel_feed"] == 100
        assert service.get(profile["id"])["calibration"]["travel_feed"] == 100
        backup = json.loads(path.with_suffix(".json.before-mm-s.bak").read_text())
        assert backup["calibration"]["travel_feed"] == 6000

    def test_imported_legacy_profile_and_bundle_preserve_speed(self, service):
        payload = service.export_profile(service.active_id())
        payload["profile"]["calibration"].pop("z_max_feedrate")
        payload["profile"]["calibration"].update(travel_feed=6000, draw_feed=3000, z_feed=1000)
        imported = service.import_profile(payload)
        assert imported["calibration"]["draw_feed"] == 50
        bundle = service.export_bundle()
        payload["profile"]["id"] = service.active_id()
        bundle["profiles"] = [payload["profile"]]
        service.import_bundle(bundle, replace=True)
        assert service.get(payload["profile"]["id"])["calibration"]["draw_feed"] == 50

    def test_xml_units_roundtrip_and_legacy_import(self):
        from plotter.artwork.export import calibration_from_xml, calibration_to_xml

        legacy = (
            '<plotterCalibration><feedrates travel="6000" draw="3000" '
            'z="1000"/></plotterCalibration>'
        )
        cal = calibration_from_xml(legacy)
        assert cal.travel_feed == 100
        assert calibration_from_xml(calibration_to_xml(cal)).z_feed == pytest.approx(1000 / 60)
