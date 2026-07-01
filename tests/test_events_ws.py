from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from plotter.web.app import create_app


@pytest.fixture
def client(workspace):
    return TestClient(create_app())


def _enable_mcp(client: TestClient, token: str = "mcp-test-token") -> str:
    r = client.patch(
        "/api/settings",
        json={"settings": {"mcp.enabled": True, "mcp.token": token}},
    )
    assert r.status_code == 200
    return token


def _call_tool(client: TestClient, token: str, name: str, arguments: dict | None = None) -> None:
    r = client.post(
        "/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "jsonrpc": "2.0",
            "id": name,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        },
    )
    assert r.status_code == 200


def _next_event(ws, type_: str, attempts: int = 10) -> dict:
    for _ in range(attempts):
        event = ws.receive_json()
        if event.get("type") == type_:
            return event
    raise AssertionError(f"no {type_!r} event received")


def test_mcp_tool_call_broadcasts_event(client: TestClient):
    token = _enable_mcp(client)
    with client.websocket_connect("/api/events/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        _call_tool(client, token, "get_active_profile")
        event = _next_event(ws, "mcp")
        assert event["tool"] == "get_active_profile"
        assert event["ok"] is True
        assert event["changed"] is False


def test_document_mutation_broadcasts_event(client: TestClient):
    with client.websocket_connect("/api/events/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        r = client.post("/api/pages", json={})
        assert r.status_code == 200
        event = _next_event(ws, "document")
        assert event["action"] == "create"
        assert event["pageId"]
