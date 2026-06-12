from __future__ import annotations

import json
import re

import pytest

from plotter.coloring_pages import ColoringPageGenerator, generate_coloring_page
from plotter.coloring_pages.seed import normalize_seed


MANDALA_MODES = ["flower", "star", "butterfly", "sun", "nature"]
PATTERN_MODES = ["truchet", "voronoi", "hex_mosaic", "wave_field", "penrose"]


def _metadata(svg: str) -> dict:
    match = re.search(r"<metadata>(.*?)</metadata>", svg, re.S)
    assert match
    return json.loads(match.group(1))


def test_normalize_seed_is_stable_for_strings():
    assert normalize_seed("sunny-42") == normalize_seed("sunny-42")
    assert normalize_seed("sunny-42") != normalize_seed("other")
    assert normalize_seed(12345) == 12345


@pytest.mark.parametrize("mode", MANDALA_MODES)
def test_mandala_coloring_pages_are_deterministic(mode):
    gen = ColoringPageGenerator()
    a = gen.generate_mandala_page("anna-7", mode, 164, 200)
    b = gen.generate_mandala_page("anna-7", mode, 164, 200)
    c = gen.generate_mandala_page("max-12", mode, 164, 200)

    assert a.svg == b.svg
    assert a.polylines == b.polylines
    assert a.svg != c.svg
    assert 'stroke="black"' in a.svg
    assert 'fill="white"' in a.svg
    assert _metadata(a.svg)["function"] == "generate_mandala_coloring_page"


@pytest.mark.parametrize("mode", PATTERN_MODES)
def test_math_pattern_coloring_pages_are_deterministic(mode):
    gen = ColoringPageGenerator()
    a = gen.generate_math_pattern_page("max-12", mode, 164, 200)
    b = gen.generate_math_pattern_page("max-12", mode, 164, 200)
    c = gen.generate_math_pattern_page("anna-7", mode, 164, 200)

    assert a.svg == b.svg
    assert a.polylines == b.polylines
    assert a.svg != c.svg
    assert len(a.polylines) > 2
    assert _metadata(a.svg)["function"] == "generate_math_pattern_coloring_page"


def test_generate_coloring_page_dispatches_to_svg():
    svg = generate_coloring_page(
        category="coloring_pages",
        function="math_pattern",
        mode="truchet",
        seed="sunny-42",
        width_mm=164,
        height_mm=200,
    )
    meta = _metadata(svg)
    assert meta["mode"] == "truchet"
    assert meta["seed"] == "sunny-42"
    assert meta["normalized_seed"] == normalize_seed("sunny-42")


def test_show_seed_adds_visible_plotter_lines_but_keeps_metadata():
    gen = ColoringPageGenerator()
    hidden = gen.generate_mandala_page("12345", "flower", 164, 200, show_seed=False)
    visible = gen.generate_mandala_page("12345", "flower", 164, 200, show_seed=True)

    assert len(visible.polylines) > len(hidden.polylines)
    assert _metadata(hidden.svg)["seed"] == "12345"
    assert _metadata(hidden.svg)["show_seed"] is False
    assert _metadata(visible.svg)["show_seed"] is True


def test_complexity_changes_mandala_structure_deterministically():
    gen = ColoringPageGenerator()
    simple = gen.generate_mandala_page("demo", "nature", 164, 200, complexity=0.1)
    complex_page = gen.generate_mandala_page("demo", "nature", 164, 200, complexity=0.9)

    assert simple.svg != complex_page.svg
    assert len(complex_page.polylines) > len(simple.polylines)


def test_coloring_page_route_clamps_to_plot_area(workspace):
    from fastapi.testclient import TestClient

    from plotter.calibration import Calibration
    from plotter.web.app import create_app

    Calibration(plot_width=150.0, plot_height=120.0).save()
    client = TestClient(create_app())
    payload = client.get(
        "/api/coloring-pages",
        params={"function": "mandala", "mode": "flower", "seed": "demo", "width": 1900, "height": 1900},
    ).json()
    assert payload["width"] == 150.0
    assert payload["height"] == 120.0
    assert payload["lines"]
    assert payload["metadata"]["normalized_seed"] == normalize_seed("demo")
