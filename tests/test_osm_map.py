from __future__ import annotations

import pytest

from plotter.osm import BBox, parse_layers
from plotter.osm.generate import generate_osm_map
from plotter.osm.overpass import build_overpass_query, fetch_overpass
from plotter.osm.types import OsmMapRequest

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
        {
            "type": "way",
            "id": 2,
            "tags": {"building": "yes"},
            "geometry": [
                {"lat": 52.515, "lon": 13.36},
                {"lat": 52.515, "lon": 13.365},
                {"lat": 52.51, "lon": 13.365},
                {"lat": 52.51, "lon": 13.36},
                {"lat": 52.515, "lon": 13.36},
            ],
        },
    ]
}


def test_parse_layers_deduplicates_and_preserves_order():
    assert parse_layers("streets, waterways, streets,buildings") == (
        "streets",
        "waterways",
        "buildings",
    )


def test_parse_layers_rejects_unknown_layer():
    with pytest.raises(ValueError, match="Unknown map layer"):
        parse_layers("streets,restaurants")


def test_bbox_rejects_large_area():
    with pytest.raises(ValueError, match="too large"):
        BBox(south=52.0, west=13.0, north=52.4, east=13.1).validate()


def test_build_overpass_query_uses_selected_layers():
    query = build_overpass_query(
        BBox(south=52.50, west=13.35, north=52.52, east=13.39),
        ("streets", "buildings", "waterways"),
    )
    assert '["highway"~' in query
    assert '["building"]' in query
    assert '["waterway"~' in query
    assert "(52.5000000,13.3500000,52.5200000,13.3900000)" in query


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


def test_generate_osm_map_projects_overpass_ways():
    req = OsmMapRequest(
        bbox=BBox(south=52.50, west=13.35, north=52.52, east=13.39),
        layers=("streets", "buildings"),
        width=160,
        height=120,
        detail=1,
        include_frame=True,
    )
    result = generate_osm_map(req, fetcher=lambda _query: SAMPLE_OVERPASS)
    assert result.lines[0] == [(0.0, 0.0), (160, 0.0), (160, 120), (0.0, 120), (0.0, 0.0)]
    assert result.lines[1] == [(0.0, 0.0), (80.0, 48.0), (160.0, 120.0)]
    assert result.lines[2][0] == result.lines[2][-1]
    assert result.metadata["status"] == "loaded"
    assert result.metadata["line_count"] == 3
    assert result.metadata["point_count"] == 13


def test_generate_osm_map_reduces_excessive_detail(monkeypatch):
    import plotter.osm.generate as osm_generate

    monkeypatch.setattr(osm_generate, "MAX_LINES", 8)
    data = {
        "elements": [
            {
                "type": "way",
                "id": i,
                "tags": {"building": "yes"},
                "geometry": [
                    {"lat": 52.50 + i * 0.0001, "lon": 13.35},
                    {"lat": 52.50 + i * 0.0001, "lon": 13.36},
                ],
            }
            for i in range(20)
        ]
    }
    req = OsmMapRequest(
        bbox=BBox(south=52.50, west=13.35, north=52.52, east=13.39),
        layers=("buildings",),
        width=160,
        height=120,
        detail=1,
        include_frame=True,
    )

    result = generate_osm_map(req, fetcher=lambda _query: data)

    assert result.metadata["detail_reduced"] is True
    assert result.metadata["line_count"] <= 8
    assert result.lines[0] == [(0.0, 0.0), (160, 0.0), (160, 120), (0.0, 120), (0.0, 0.0)]


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
            "layers": "streets,buildings,waterways",
            "width": 1900,
            "height": 1900,
            "include_frame": True,
        },
    ).json()
    assert payload["width"] == 150.0
    assert payload["height"] == 120.0
    assert payload["viewBox"] == "0 0 150 120"
    assert payload["lines"][0] == [
        [0.0, 0.0],
        [150.0, 0.0],
        [150.0, 120.0],
        [0.0, 120.0],
        [0.0, 0.0],
    ]
    assert payload["metadata"]["layers"] == ["streets", "buildings", "waterways"]
