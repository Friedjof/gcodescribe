from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from plotter.web.app import create_app


@pytest.fixture(autouse=True)
def stream_auth_bypass(monkeypatch):
    monkeypatch.setenv("PLOTTER_AUTH_TEST_BYPASS", "1")
    from plotter.stream.session import StreamSessionManager
    from plotter.web.routes import stream

    # TestClient opens separate event loops; production has one application loop.
    monkeypatch.setattr(stream, "manager", StreamSessionManager())
    monkeypatch.setattr("plotter.web.app.use_serial", lambda: False)


@pytest.fixture
def stream_client():
    # Context mode shares one event loop across HTTP and every WebSocket,
    # exactly like the single-process production server.
    with TestClient(create_app()) as client:
        yield client


def test_stream_accepts_dev_bypass_for_publish_ws(workspace, monkeypatch, stream_client):
    monkeypatch.delenv("PLOTTER_AUTH_TEST_BYPASS", raising=False)
    monkeypatch.setenv("PLOTTER_AUTH_DEV_BYPASS", "1")
    client = stream_client
    session = client.post("/api/stream/sessions", json={"sourceId": "designer"}).json()

    with client.websocket_connect(f"/api/stream/ws/publish/{session['sessionId']}") as publisher:
        assert publisher.receive_json()["t"] == "accepted"


def test_create_stream_session_returns_viewer_url(workspace, stream_client):
    client = stream_client

    response = client.post("/api/stream/sessions", json={"sourceId": "designer"})

    assert response.status_code == 200
    body = response.json()
    assert body["sessionId"]
    assert body["viewerToken"]
    assert body["viewerUrl"].startswith(f"/live#s={body['sessionId']}&k=")


def test_stream_rejects_wrong_viewer_token(workspace, stream_client):
    client = stream_client
    session = client.post("/api/stream/sessions", json={"sourceId": "designer"}).json()

    with client.websocket_connect(f"/api/stream/ws/view/{session['sessionId']}") as viewer:
        viewer.send_json({"v": 1, "t": "join", "ts": 0, "token": "wrong"})
        with pytest.raises(WebSocketDisconnect) as exc:
            viewer.receive_json()
        assert exc.value.code == 1008


def test_stream_relays_snapshot_and_cursor_to_viewer(workspace, stream_client):
    client = stream_client
    session = client.post("/api/stream/sessions", json={"sourceId": "designer"}).json()

    with client.websocket_connect(f"/api/stream/ws/publish/{session['sessionId']}") as publisher:
        assert publisher.receive_json()["t"] == "accepted"

        with client.websocket_connect(f"/api/stream/ws/view/{session['sessionId']}") as viewer:
            viewer.send_json({"v": 1, "t": "join", "ts": 0, "token": session["viewerToken"]})
            assert viewer.receive_json()["t"] == "ready"

            snapshot = {
                "v": 1,
                "t": "snapshot",
                "ts": 1,
                "sourceId": "designer",
                "meta": {"sourceId": "designer"},
                "snapshot": {"ok": True},
            }
            publisher.send_json(snapshot)
            assert viewer.receive_json() == snapshot

            cursor = {"v": 1, "t": "cursor", "ts": 2, "x": 0.25, "y": 0.5, "inside": True}
            publisher.send_json(cursor)
            assert viewer.receive_json() == cursor

            click = {"v": 1, "t": "click", "ts": 3, "x": 0.25, "y": 0.5}
            publisher.send_json(click)
            assert viewer.receive_json() == click


def test_scene_delta_updates_reconnect_snapshot_and_supports_legacy_viewers(
    workspace, stream_client
):
    client = stream_client
    session = client.post("/api/stream/sessions", json={"sourceId": "designer"}).json()
    path = f"/api/stream/ws/view/{session['sessionId']}"
    original = {"id": "o", "cachedPolylines": [[[1, 2], [3, 4]]], "transform": {"x": 0}}
    snapshot = {
        "v": 1,
        "t": "snapshot",
        "ts": 1,
        "sourceId": "designer",
        "meta": {},
        "snapshot": {"page": {"id": "p", "objects": [original]}},
    }
    with client.websocket_connect(f"/api/stream/ws/publish/{session['sessionId']}") as publisher:
        assert publisher.receive_json()["t"] == "accepted"
        with client.websocket_connect(path) as modern, client.websocket_connect(path) as legacy:
            modern.send_json(
                {"t": "join", "token": session["viewerToken"], "capabilities": ["scene-patch"]}
            )
            legacy.send_json({"t": "join", "token": session["viewerToken"]})
            assert modern.receive_json()["t"] == "ready"
            assert legacy.receive_json()["t"] == "ready"
            publisher.send_json(snapshot)
            assert modern.receive_json() == snapshot
            assert legacy.receive_json() == snapshot
            delta = {
                "v": 1,
                "t": "scene-patch",
                "ts": 2,
                "pageId": "p",
                "changes": [{"id": "o", "transform": {"x": 42}}],
                "removed": [],
            }
            publisher.send_json(delta)
            assert modern.receive_json() == delta
            full = legacy.receive_json()
            assert full["snapshot"]["page"]["objects"] == [{**original, "transform": {"x": 42}}]
            with client.websocket_connect(path) as reconnect:
                reconnect.send_json({"t": "join", "token": session["viewerToken"]})
                assert reconnect.receive_json()["t"] == "ready"
                assert reconnect.receive_json() == full
