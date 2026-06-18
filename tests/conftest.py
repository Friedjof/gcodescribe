from __future__ import annotations

import pytest

import plotter.document as document
import plotter.position as position
import plotter.printer.factory as printer_factory
import plotter.services.auth as auth
from plotter.calibration import Calibration


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """Isolated data dir + file state store + fresh singletons."""
    monkeypatch.setenv("PLOTTER_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REDIS_URL", "redis://localhost:1/0")  # unreachable -> file store
    monkeypatch.setenv("PLOTTER_AUTH_TEST_BYPASS", "true")
    position._tracker = None
    document._doc = None
    auth._store = None
    printer_factory.reset_manager()
    yield tmp_path
    position._tracker = None
    document._doc = None
    auth._store = None
    printer_factory.reset_manager()


@pytest.fixture
def cal(workspace) -> Calibration:
    """A paper-calibrated setup: A5-ish sheet at (25, 35), pen on paper at Z 1.4."""
    c = Calibration(
        origin_x=25.0,
        origin_y=35.0,
        plot_width=160.0,
        plot_height=160.0,
        pen_down_z=1.4,
        pen_up_z=7.4,
        paper_corners={"bl": [20.0, 30.0], "tr": [190.0, 200.0]},
        paper_margin=5.0,
    )
    c.save()
    return c
