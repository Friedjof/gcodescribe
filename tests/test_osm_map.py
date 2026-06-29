from __future__ import annotations

import math

import pytest

from plotter.osm import BBox
from plotter.osm.generate import generate_osm_map
from plotter.osm.overpass import build_overpass_query, fetch_overpass
from plotter.osm.types import OsmMapRequest


def _merc_y(lat: float) -> float:
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


# The roads query returns only road ways (tag filtering happens server-side in
# the Overpass query), so the fixture is a single road.
SAMPLE_OVERPASS = {
    "elements": [
        {
            "type": "way",
            "id": 1,
            "tags": {"highway": "residential"},
            "geometry": [
                {"lat": 52.52, "lon": 13.35},
                {"lat": 52.512, "lon": 13.37},
                {"lat": 52.50, "lon": 13.39},
            ],
        },
    ]
}


def test_bbox_rejects_large_area():
    with pytest.raises(ValueError, match="too large"):
        BBox(south=52.0, west=13.0, north=52.7, east=13.1).validate()


def test_build_overpass_query_roads_in_bbox():
    query = build_overpass_query(BBox(south=52.50, west=13.35, north=52.52, east=13.39))
    assert '["highway"~' in query
    assert "(52.5000000,13.3500000,52.5200000,13.3900000)" in query
    # roads-only: no building/waterway selectors any more
    assert "building" not in query
    assert "waterway" not in query


def test_build_overpass_query_uses_area_id_when_given():
    query = build_overpass_query(
        BBox(south=52.50, west=13.35, north=52.52, east=13.39),
        area_id=3600062422,
    )
    assert "area(3600062422)->.searchArea;" in query
    assert "(area.searchArea);" in query
    assert "52.5000000" not in query  # bbox is not used in boundary mode


def test_fetch_overpass_sends_user_agent(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"elements": []}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        return Response()

    import plotter.osm.overpass as overpass

    monkeypatch.setattr(overpass.httpx, "post", fake_post)
    assert fetch_overpass("[out:json];out;") == {"elements": []}
    assert captured["headers"]["User-Agent"].startswith("GCodeScribe/")
    assert captured["headers"]["Accept"] == "application/json"


def test_generate_osm_map_centers_roads():
    req = OsmMapRequest(
        bbox=BBox(south=52.50, west=13.35, north=52.52, east=13.39),
        width=160,
        height=120,
        detail=1,
        include_frame=True,
    )
    result = generate_osm_map(req, fetcher=lambda _query: SAMPLE_OVERPASS)
    # Output is the full page; the roads are fitted with the mercator aspect and
    # centred inside it (not stretched, not top-left aligned).
    assert result.width == pytest.approx(160)
    assert result.height == pytest.approx(120)

    frame = result.lines[0]
    fx0, fy0 = frame[0]
    fx1, _ = frame[1]
    _, fy1 = frame[2]
    fw, fh = fx1 - fx0, fy1 - fy0
    span_x = math.radians(13.39) - math.radians(13.35)
    span_y = _merc_y(52.52) - _merc_y(52.50)
    assert fw / fh == pytest.approx(span_x / span_y, rel=1e-3)  # not stretched
    assert fx0 == pytest.approx((160 - fw) / 2, abs=0.05)  # centred horizontally
    assert fy0 == pytest.approx((120 - fh) / 2, abs=0.05)  # centred vertically
    assert min(fx0, fy0) == pytest.approx(4.0, abs=0.3)  # margin on the limiting axis

    street = result.lines[1]
    assert street[0] == pytest.approx((fx0, fy0))  # NW corner of the content
    assert street[-1] == pytest.approx((fx1, fy1))  # SE corner of the content
    assert result.metadata["status"] == "loaded"
    assert result.metadata["line_count"] == 2  # frame + 1 road


def test_fit_detail_budget_simplifies_without_dropping(monkeypatch):
    import plotter.osm.generate as osm_generate

    monkeypatch.setattr(osm_generate, "MAX_POINTS", 10)
    # Three wiggly lines, well over the point budget. The budget must simplify
    # them down — but never drop a whole line (that would re-create islands).
    lines = [[(float(i), float(i % 2)) for i in range(20)] for _ in range(3)]
    out, reduced = osm_generate._fit_detail_budget(lines, 0)

    assert reduced is True
    assert sum(len(line) for line in out) <= 10
    assert len(out) == 3  # no line dropped


def test_osm_map_route_contract_and_plot_area_clamp(workspace, monkeypatch):
    from fastapi.testclient import TestClient

    import plotter.osm.generate as osm_generate
    from plotter.calibration import Calibration
    from plotter.web.app import create_app

    monkeypatch.setattr(osm_generate, "fetch_overpass", lambda _query: SAMPLE_OVERPASS)
    Calibration(plot_width=150.0, plot_height=120.0).save()
    client = TestClient(create_app())
    payload = client.get(
        "/api/osm-map",
        params={
            "south": 52.50,
            "west": 13.35,
            "north": 52.52,
            "east": 13.39,
            "width": 1900,
            "height": 1900,
            "include_frame": True,
        },
    ).json()
    # Requested 1900×1900 is clamped to the 150×120 plot area; the page is that
    # full box and the roads are centred inside it.
    assert payload["width"] == pytest.approx(150.0)
    assert payload["height"] == pytest.approx(120.0)
    assert payload["viewBox"] == "0 0 150 120"
    frame = payload["lines"][0]
    assert len(frame) == 5
    fx0, fy0 = frame[0]
    fx1, _ = frame[1]
    _, fy1 = frame[2]
    assert fx0 == pytest.approx((150.0 - (fx1 - fx0)) / 2, abs=0.05)  # centred
    assert fy0 == pytest.approx((120.0 - (fy1 - fy0)) / 2, abs=0.05)
    assert payload["metadata"]["status"] == "loaded"


def _component_count(lines, tol=0.5) -> int:
    inv = 1.0 / tol
    parent: dict[int, int] = {}

    def find(a: int) -> int:
        parent.setdefault(a, a)
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    seen: dict[tuple[int, int], int] = {}
    for i, line in enumerate(lines):
        find(i)
        for end in (line[0], line[-1]):
            key = (round(end[0] * inv), round(end[1] * inv))
            if key in seen:
                union(i, seen[key])
            else:
                seen[key] = i
    return len({find(i) for i in range(len(lines))})


def test_generate_connects_disconnected_roads():
    data = {
        "elements": [
            {"type": "way", "id": 1, "tags": {"highway": "residential"},
             "geometry": [{"lat": 52.50, "lon": 13.35}, {"lat": 52.50, "lon": 13.36}]},
            {"type": "way", "id": 2, "tags": {"highway": "residential"},
             "geometry": [{"lat": 52.52, "lon": 13.38}, {"lat": 52.52, "lon": 13.39}]},
        ]
    }
    req = OsmMapRequest(
        bbox=BBox(south=52.49, west=13.34, north=52.53, east=13.40),
        width=200, height=200, detail=1,
    )
    result = generate_osm_map(req, fetcher=lambda _query: data)
    # The two separate roads are linked into ONE connected network (no islands).
    assert _component_count(result.lines) == 1


def test_osm_map_gcode_endpoint_returns_score_and_3d(workspace, monkeypatch):
    from fastapi.testclient import TestClient

    import plotter.osm.generate as osm_generate
    from plotter.calibration import Calibration
    from plotter.web.app import create_app

    monkeypatch.setattr(osm_generate, "fetch_overpass", lambda _query: SAMPLE_OVERPASS)
    Calibration(plot_width=150.0, plot_height=120.0).save()
    client = TestClient(create_app())
    payload = client.get(
        "/api/osm-map/gcode",
        params={
            "south": 52.50,
            "west": 13.35,
            "north": 52.52,
            "east": 13.39,
            "width": 1900,
            "height": 1900,
            "continuous": True,
        },
    ).json()
    assert "gcode3d" in payload
    assert isinstance(payload["score"]["total"], int)
    # One connected network drawn as a single stroke → a single pen-down.
    assert payload["metrics"]["pen_lifts"] == 1


def test_geocode_parses_and_computes_area_id():
    from plotter.osm.geocode import geocode

    rows = [
        {"osm_type": "relation", "osm_id": 62422, "lat": "50.7", "lon": "7.1",
         "display_name": "Bonn", "boundingbox": ["50.6", "50.8", "7.0", "7.2"]},
        {"osm_type": "way", "osm_id": 5, "lat": "1", "lon": "2",
         "display_name": "Way", "boundingbox": ["0", "2", "1", "3"]},
        {"osm_type": "node", "osm_id": 9, "lat": "1", "lon": "2",
         "display_name": "Node", "boundingbox": ["0", "2", "1", "3"]},
    ]
    results = geocode("__geocode_test_query__", fetcher=lambda _q, _limit: rows)

    assert results[0].area_id == 62422 + 3_600_000_000
    assert (results[0].bbox.south, results[0].bbox.north) == (50.6, 50.8)
    assert (results[0].bbox.west, results[0].bbox.east) == (7.0, 7.2)
    assert results[1].area_id == 5 + 2_400_000_000
    assert results[2].area_id is None  # nodes have no enclosing area
