from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from plotter.web.app import create_app


@pytest.fixture(autouse=True)
def stream_auth_bypass(monkeypatch):
    monkeypatch.setenv("PLOTTER_AUTH_TEST_BYPASS", "1")


def test_stream_accepts_dev_bypass_for_publish_ws(workspace, monkeypatch):
    monkeypatch.delenv("PLOTTER_AUTH_TEST_BYPASS", raising=False)
    monkeypatch.setenv("PLOTTER_AUTH_DEV_BYPASS", "1")
    client = TestClient(create_app())
    session = client.post("/api/stream/sessions", json={"sourceId": "designer"}).json()

    with client.websocket_connect(f"/api/stream/ws/publish/{session['sessionId']}") as publisher:
        assert publisher.receive_json()["t"] == "accepted"


def test_create_stream_session_returns_viewer_url(workspace):
    client = TestClient(create_app())

    response = client.post("/api/stream/sessions", json={"sourceId": "designer"})

    assert response.status_code == 200
    body = response.json()
    assert body["sessionId"]
    assert body["viewerToken"]
    assert body["viewerUrl"].startswith(f"/live#s={body['sessionId']}&k=")


def test_stream_rejects_wrong_viewer_token(workspace):
    client = TestClient(create_app())
    session = client.post("/api/stream/sessions", json={"sourceId": "designer"}).json()

    with client.websocket_connect(f"/api/stream/ws/view/{session['sessionId']}") as viewer:
        viewer.send_json({"v": 1, "t": "join", "ts": 0, "token": "wrong"})
        with pytest.raises(WebSocketDisconnect) as exc:
            viewer.receive_json()
        assert exc.value.code == 1008


def test_stream_relays_snapshot_and_cursor_to_viewer(workspace):
    client = TestClient(create_app())
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
