from __future__ import annotations

import math

import pytest

from plotter.osm import BBox
from plotter.osm.generate import generate_osm_map
from plotter.osm.overpass import build_overpass_query, fetch_overpass
from plotter.osm.types import OsmMapRequest


@pytest.fixture(autouse=True)
def clear_map_caches(tmp_path, monkeypatch):
    import plotter.osm.overpass as overpass
    from plotter.osm.generate import _cached_map, _cached_roads

    monkeypatch.setenv("PLOTTER_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(overpass, "_preferred_url", overpass.OVERPASS_URL)
    _cached_map.cache_clear()
    _cached_roads.cache_clear()
    fetch_overpass.cache_clear()
    yield
    _cached_map.cache_clear()
    _cached_roads.cache_clear()
    fetch_overpass.cache_clear()


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
    assert "out skel geom qt;" in query


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
    lines = [[(float(i), float(i % 2) + j * 10) for i in range(20)] for j in range(3)]
    out, reduced = osm_generate._fit_detail_budget(lines, 0)

    assert reduced is True
    assert sum(len(line) for line in out) <= 10
    assert len(out) == 3  # no line dropped


def test_osm_map_route_contract_and_plot_area_clamp(workspace, monkeypatch):
    from fastapi.testclient import TestClient

    from plotter.core.calibration import Calibration
    from plotter.web.app import create_app

    monkeypatch.setattr("plotter.osm.overpass.fetch_overpass", lambda _query: SAMPLE_OVERPASS)
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


def test_generate_keeps_disconnected_roads_separate():
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
    # Separate roads remain separate; map routing must not invent ink bridges.
    assert _component_count(result.lines) == 2


def test_osm_map_gcode_endpoint_returns_score_and_3d(workspace, monkeypatch):
    from fastapi.testclient import TestClient

    from plotter.core.calibration import Calibration
    from plotter.web.app import create_app

    monkeypatch.setattr("plotter.osm.overpass.fetch_overpass", lambda _query: SAMPLE_OVERPASS)
    cal = Calibration(plot_width=150.0, plot_height=120.0)
    cal.save()
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
    assert payload["gcode3d"]["bed"] == [cal.bed_width, cal.bed_height]
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


def test_overpass_partial_response_is_not_cached(monkeypatch):
    import plotter.osm.overpass as overpass

    replies = iter([
        {"elements": SAMPLE_OVERPASS["elements"], "remark": "runtime error: timed out"},
        {"elements": SAMPLE_OVERPASS["elements"], "remark": "runtime error: timed out"},
        SAMPLE_OVERPASS,
    ])

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return next(replies)

    monkeypatch.setattr(overpass.httpx, "post", lambda *a, **kw: Response())
    with pytest.raises(overpass.OverpassResourceError):
        fetch_overpass("partial-city")
    assert fetch_overpass("partial-city") == SAMPLE_OVERPASS


def test_overpass_invalid_json_becomes_readable_error(monkeypatch):
    import plotter.osm.overpass as overpass

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            raise ValueError("invalid JSON")

    monkeypatch.setattr(overpass.httpx, "post", lambda *a, **kw: Response())
    with pytest.raises(ValueError, match="invalid response"):
        fetch_overpass("invalid-json")


def test_large_query_fallback_keeps_boundary_and_deduplicates():
    from plotter.osm.overpass import OverpassResourceError, fetch_roads

    queries = []

    def load(query):
        queries.append(query)
        if len(queries) == 1:
            raise OverpassResourceError("timeout")
        return SAMPLE_OVERPASS

    data = fetch_roads(BBox(52.3, 13.0, 52.5, 13.3), 3600062422, fetcher=load)
    assert len(queries) == 3
    assert data == SAMPLE_OVERPASS  # the way appears in both tiles, once in the result
    for query in queries[1:]:
        assert "(area.searchArea)(" in query
        assert "area(3600062422)->.searchArea;" in query
    assert "[timeout:25]" in queries[1]
    assert "(52.3000000,13.0000000,52.5000000,13.1500000)" in queries[1]
    assert "(52.3000000,13.1500000,52.5000000,13.3000000)" in queries[-1]


def test_failed_tile_does_not_return_partial_city():
    from plotter.osm.overpass import OverpassResourceError, fetch_roads

    calls = 0

    def load(query):
        nonlocal calls
        calls += 1
        if calls != 2:
            raise OverpassResourceError("timeout")
        return SAMPLE_OVERPASS

    with pytest.raises(OverpassResourceError):
        fetch_roads(BBox(52.3, 13.0, 52.7, 13.8), 3600062422, fetcher=load)


def test_repeated_map_and_detail_changes_reuse_prepared_geometry(monkeypatch):
    from dataclasses import replace

    import plotter.osm.generate as osm

    downloads = []
    preparations = []
    prepare = osm._road_lines

    def load(query):
        downloads.append(query)
        return SAMPLE_OVERPASS

    def roads(*args):
        preparations.append(True)
        return prepare(*args)

    monkeypatch.setattr("plotter.osm.overpass.fetch_overpass", load)
    monkeypatch.setattr(osm, "_road_lines", roads)
    req = OsmMapRequest(BBox(52.50, 13.35, 52.52, 13.39), 160, 120, detail=1)
    result = generate_osm_map(req)
    assert generate_osm_map(req) is result
    generate_osm_map(replace(req, detail=0.1, include_frame=True))
    assert len(downloads) == len(preparations) == 1


def test_concurrent_map_requests_prepare_once(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    downloads = []

    def load(query):
        downloads.append(query)
        return SAMPLE_OVERPASS

    monkeypatch.setattr("plotter.osm.overpass.fetch_overpass", load)
    req = OsmMapRequest(BBox(52.50, 13.35, 52.52, 13.39), 160, 120)
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: generate_osm_map(req), range(8)))
    assert len(downloads) == 1
    assert all(result is results[0] for result in results)


def test_simplification_preserves_interior_junctions_and_frame(monkeypatch):
    import plotter.osm.generate as osm

    frame = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
    roads = [[(0, 5), (3, 5), (5, 5), (7, 5), (10, 5)], [(5, 5), (5, 10)]]
    simplified = osm._simplify_network(roads, 2)
    assert simplified == [[(0, 5), (5, 5), (10, 5)], [(5, 5), (5, 10)]]
    monkeypatch.setattr(osm, "MAX_POINTS", 10)
    reduced, _ = osm._fit_detail_budget([frame, *roads], 1)
    assert reduced[0] == frame
    assert (5, 5) in reduced[1]
    assert len(reduced) == 3


def test_shared_interior_vertices_do_not_add_artificial_connectors():
    from plotter.osm.generate import _connect_components

    roads = [[(0, 0), (5, 0), (10, 0)], [(5, 0), (5, 5)]]
    assert _connect_components(roads, 0.001) == roads


def test_dense_islands_connect_when_nearest_neighbors_are_all_local():
    from plotter.osm.generate import _connect_components

    roads = [[(float(i) + offset, 0.0) for i in range(40)] for offset in (0, 100, 200)]
    connected = _connect_components(roads, 0.001)
    assert _component_count(connected, tol=0.001) == 1
    assert {point for line in roads for point in line} <= {
        point for line in connected for point in line
    }


def test_maximum_detail_retains_original_road_vertices():
    from plotter.osm.generate import _simplify_network, _simplify_tolerance

    road = [(0, 0), (0.01, 0.001), (0.02, 0)]
    assert _simplify_network([road], _simplify_tolerance(1)) == [road]


def test_boundary_mode_still_validates_coordinate_order():
    req = OsmMapRequest(BBox(52.7, 13.0, 52.3, 13.8), 180, 180, area_id=3600062422)
    with pytest.raises(ValueError, match="south < north"):
        generate_osm_map(req, fetcher=lambda _: SAMPLE_OVERPASS)


def test_server_timeout_switches_to_working_backend_and_keeps_it(monkeypatch):
    import httpx

    import plotter.osm.overpass as overpass

    urls = []

    def post(url, **kwargs):
        urls.append(url)
        request = httpx.Request("POST", url)
        if url == overpass.OVERPASS_URL:
            return httpx.Response(504, request=request)
        return httpx.Response(200, json=SAMPLE_OVERPASS, request=request)

    monkeypatch.setattr(overpass.httpx, "post", post)
    assert fetch_overpass("first-city") == SAMPLE_OVERPASS
    assert fetch_overpass("second-city") == SAMPLE_OVERPASS
    assert urls == [overpass.OVERPASS_URL, overpass.OVERPASS_FALLBACK_URL,
                    overpass.OVERPASS_FALLBACK_URL]


def test_service_outage_does_not_trigger_recursive_queries(monkeypatch):
    import plotter.osm.overpass as overpass

    calls = []

    def unavailable(query):
        calls.append(query)
        raise overpass.OverpassUnavailableError("offline")

    with pytest.raises(overpass.OverpassUnavailableError):
        overpass.fetch_roads(BBox(52.3, 13.0, 52.5, 13.2), fetcher=unavailable)
    assert len(calls) == 1


def test_timed_out_subtile_is_split_again_without_losing_roads():
    from plotter.osm.overpass import OverpassResourceError, fetch_roads

    queries = []

    def load(query):
        queries.append(query)
        if len(queries) in (1, 2):
            raise OverpassResourceError("timeout")
        return {"elements": [{**SAMPLE_OVERPASS["elements"][0], "id": len(queries)}]}

    result = fetch_roads(BBox(52.3, 13.0, 52.5, 13.2), 3600062422, fetcher=load)
    assert len(queries) == 5
    assert {element["id"] for element in result["elements"]} == {3, 4, 5}
    assert all("(area.searchArea)(" in query for query in queries[1:])


def test_exceptionally_large_region_starts_with_small_tiles():
    from plotter.osm.overpass import fetch_roads

    queries = []

    def load(query):
        queries.append(query)
        return SAMPLE_OVERPASS

    assert fetch_roads(BBox(50, 10, 52, 14), 3600062422, fetcher=load) == SAMPLE_OVERPASS
    assert len(queries) == 8
    assert all("(area.searchArea)(" in query and "[timeout:25]" in query for query in queries)


def test_download_request_limit_stops_retries(monkeypatch):
    import plotter.osm.overpass as overpass

    calls = []

    def load(query):
        calls.append(query)
        raise overpass.OverpassResourceError("timeout")

    monkeypatch.setattr(overpass, "MAX_TILE_REQUESTS", 2)
    with pytest.raises(overpass.OverpassResourceError, match="nicht vollständig"):
        overpass.fetch_roads(BBox(52.3, 13.0, 52.5, 13.2), fetcher=load)
    assert len(calls) == 2


def test_disk_cache_survives_memory_cache_reset(monkeypatch):
    import plotter.osm.overpass as overpass

    calls = []

    def load(query):
        calls.append(query)
        return SAMPLE_OVERPASS

    monkeypatch.setattr(overpass, "fetch_overpass", load)
    box = BBox(52.50, 13.35, 52.52, 13.39)
    assert overpass.fetch_roads(box) == SAMPLE_OVERPASS
    from plotter.osm.generate import _cached_map, _cached_roads

    _cached_map.cache_clear()
    _cached_roads.cache_clear()

    def offline(query):
        raise AssertionError("Complete cached cities should not need the network")

    monkeypatch.setattr(overpass, "fetch_overpass", offline)
    assert overpass.fetch_roads(box) == SAMPLE_OVERPASS
    assert len(calls) == 1


def test_incomplete_download_is_not_written_to_disk(monkeypatch):
    import plotter.osm.overpass as overpass
    from plotter.osm.cache import read_roads

    calls = 0

    def load(query):
        nonlocal calls
        calls += 1
        if calls == 1:
            return SAMPLE_OVERPASS
        raise overpass.OverpassUnavailableError("offline")

    box = BBox(50, 10, 52, 14)
    monkeypatch.setattr(overpass, "fetch_overpass", load)
    with pytest.raises(overpass.OverpassUnavailableError):
        overpass.fetch_roads(box, 3600062422)
    assert read_roads(box, 3600062422, overpass.ROADS_SELECTOR) is None


def test_corrupt_or_expired_disk_cache_allows_download(monkeypatch):
    import os
    import time

    import plotter.osm.cache as cache
    import plotter.osm.overpass as overpass

    box = BBox(52.50, 13.35, 52.52, 13.39)
    path = cache._path(box, None, overpass.ROADS_SELECTOR)
    path.parent.mkdir(parents=True)
    path.write_bytes(b"broken gzip")
    monkeypatch.setattr(overpass, "fetch_overpass", lambda _: SAMPLE_OVERPASS)
    assert overpass.fetch_roads(box) == SAMPLE_OVERPASS
    assert cache.read_roads(box, None, overpass.ROADS_SELECTOR) == SAMPLE_OVERPASS
    expired = time.time() - cache.CACHE_TTL_SECONDS - 1
    os.utime(path, (expired, expired))
    assert cache.read_roads(box, None, overpass.ROADS_SELECTOR) is None


def test_cache_write_error_does_not_fail_complete_download(monkeypatch):
    import plotter.osm.cache as cache
    import plotter.osm.overpass as overpass

    def unwritable(*args, **kwargs):
        raise OSError("Read-only filesystem")

    monkeypatch.setattr(cache.tempfile, "NamedTemporaryFile", unwritable)
    monkeypatch.setattr(overpass, "fetch_overpass", lambda _: SAMPLE_OVERPASS)
    assert overpass.fetch_roads(BBox(52.50, 13.35, 52.52, 13.39)) == SAMPLE_OVERPASS


def test_rate_limit_waits_once_before_retrying(monkeypatch):
    import httpx

    import plotter.osm.overpass as overpass

    calls = []
    waits = []

    def post(url, **kwargs):
        calls.append(url)
        request = httpx.Request("POST", url)
        if len(calls) <= 2:
            return httpx.Response(429, headers={"Retry-After": "5"}, request=request)
        return httpx.Response(200, json=SAMPLE_OVERPASS, request=request)

    monkeypatch.setattr(overpass.httpx, "post", post)
    monkeypatch.setattr(overpass.time, "sleep", waits.append)
    assert fetch_overpass("rate-limited-city") == SAMPLE_OVERPASS
    assert waits == [5]
    assert len(calls) == 3
    assert calls[-1] == overpass.OVERPASS_FALLBACK_URL


def test_rate_limit_does_not_wait_beyond_download_budget(monkeypatch):
    import httpx

    import plotter.osm.overpass as overpass

    calls = []
    waits = []

    def post(url, **kwargs):
        calls.append(url)
        return httpx.Response(429, headers={"Retry-After": "5"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(overpass.httpx, "post", post)
    monkeypatch.setattr(overpass.time, "sleep", waits.append)
    monkeypatch.setattr(overpass, "_remaining_seconds", lambda: 4)
    with pytest.raises(overpass.OverpassUnavailableError):
        fetch_overpass("rate-limited-budget")
    assert waits == []
    assert len(calls) == 2


def test_request_timeout_respects_remaining_download_budget(monkeypatch):
    import plotter.osm.overpass as overpass

    timeouts = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return SAMPLE_OVERPASS

    def post(url, **kwargs):
        timeouts.append(kwargs["timeout"])
        return Response()

    monkeypatch.setattr(overpass.httpx, "post", post)
    monkeypatch.setattr(overpass, "_remaining_seconds", lambda: 3)
    assert fetch_overpass("[out:json][timeout:90];out;") == SAMPLE_OVERPASS
    assert timeouts[0].read == 3
    assert timeouts[0].connect == 3


def test_retry_reuses_completed_tiles_after_failed_download(monkeypatch):
    import plotter.osm.overpass as overpass

    first_calls = []

    def failing(query):
        first_calls.append(query)
        if len(first_calls) > 1:
            raise overpass.OverpassUnavailableError("offline")
        return SAMPLE_OVERPASS

    box = BBox(50, 10, 52, 14)
    monkeypatch.setattr(overpass, "fetch_overpass", failing)
    with pytest.raises(overpass.OverpassUnavailableError):
        overpass.fetch_roads(box, 3600062422)
    second_calls = []

    def success(query):
        second_calls.append(query)
        return SAMPLE_OVERPASS

    monkeypatch.setattr(overpass, "fetch_overpass", success)
    assert overpass.fetch_roads(box, 3600062422) == SAMPLE_OVERPASS
    assert len(second_calls) == 7  # the complete first tile survived the failure
    assert first_calls[0] not in second_calls


@pytest.mark.parametrize("endpoint", ["/api/osm-map", "/api/osm-map/gcode"])
def test_osm_service_outage_is_not_reported_as_invalid_map(workspace, monkeypatch, endpoint):
    from fastapi.testclient import TestClient

    from plotter.osm.overpass import OverpassUnavailableError
    from plotter.web.app import create_app

    def unavailable(*args, **kwargs):
        raise OverpassUnavailableError("Die Kartendaten-Server sind momentan ausgelastet.")

    monkeypatch.setattr("plotter.osm.generate.fetch_roads", unavailable)
    response = TestClient(create_app()).get(endpoint, params={
        "south": 52.5, "west": 13.35, "north": 52.52, "east": 13.39,
    })
    assert response.status_code == 503
    assert "ausgelastet" in response.json()["detail"]
