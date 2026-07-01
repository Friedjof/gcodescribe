from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import plotter.services
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


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _call_tool(client: TestClient, token: str, name: str, arguments: dict | None = None) -> dict:
    result = _call_tool_raw(client, token, name, arguments)
    assert result["isError"] is False
    return json.loads(result["content"][0]["text"])


def _call_tool_raw(
    client: TestClient, token: str, name: str, arguments: dict | None = None
) -> dict:
    r = client.post(
        "/mcp",
        headers=_headers(token),
        json={
            "jsonrpc": "2.0",
            "id": name,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        },
    )
    assert r.status_code == 200
    result = r.json()["result"]
    return result


class FakePrinterController:
    uploads: list[str] = []
    homes = 0
    moves: list[dict] = []
    pens: list[bool] = []
    commands: list[str] = []

    def __init__(self):
        self.client = self

    def status(self) -> dict:
        return {"configured": True, "online": True, "job": None, "backend": "fake"}

    def position(self) -> dict:
        return {"x": 0, "y": 0, "z": 0, "homed": True, "homed_axes": ["x", "y", "z"]}

    def home(self, axes=None) -> dict:
        self.__class__.homes += 1
        return self.position()

    def move_to(self, x, y, *, pen_up_first=True, limit="bed") -> dict:
        self.__class__.moves.append(
            {"x": x, "y": y, "pen_up_first": pen_up_first, "limit": limit}
        )
        return {"x": x, "y": y, "z": 7.4, "homed": True, "homed_axes": ["x", "y", "z"]}

    def pen(self, down: bool) -> dict:
        self.__class__.pens.append(down)
        return {"z": 1.4 if down else 7.4, "position": self.position()}

    def upload(self, gcode_path, *, start: bool = False) -> dict:
        self.__class__.uploads.append(gcode_path.name)
        return {"done": True, "start": start, "files": {"local": {"name": gcode_path.name}}}

    def job_command(self, command: str) -> None:
        self.__class__.commands.append(command)


def test_mcp_disabled_returns_404(client):
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    assert r.status_code == 404


def test_mcp_unavailable_in_flatpak(workspace):
    with patch.dict("os.environ", {"GCODESCRIBE_PACKAGING": "flatpak"}, clear=False):
        c = TestClient(create_app())
        token = _enable_mcp(c)
        r = c.post(
            "/mcp",
            headers=_headers(token),
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
        )
    assert r.status_code == 404


def test_mcp_missing_token_returns_401(client):
    _enable_mcp(client)
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    assert r.status_code == 401


def test_mcp_wrong_token_returns_401(client):
    _enable_mcp(client)
    r = client.post(
        "/mcp",
        headers=_headers("wrong"),
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
    )
    assert r.status_code == 401


def test_mcp_initialize_with_valid_token(client):
    token = _enable_mcp(client)
    r = client.post(
        "/mcp",
        headers=_headers(token),
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
    )
    assert r.status_code == 200
    d = r.json()
    assert d["jsonrpc"] == "2.0"
    assert d["id"] == 1
    assert d["result"]["serverInfo"]["name"] == "gcodescribe"
    assert "tools" in d["result"]["capabilities"]


def test_mcp_tools_list_exposes_read_only_tools(client):
    token = _enable_mcp(client)
    r = client.post(
        "/mcp",
        headers=_headers(token),
        json={"jsonrpc": "2.0", "id": "tools", "method": "tools/list"},
    )
    assert r.status_code == 200
    tools = r.json()["result"]["tools"]
    names = {tool["name"] for tool in tools}
    assert {
        "get_printer_status",
        "get_mcp_overview",
        "get_mcp_tutorial",
        "printer_home",
        "printer_move_to",
        "printer_pen",
        "printer_job_command",
        "get_active_profile",
        "list_pages",
        "list_mcp_pages",
        "get_page",
        "delete_mcp_page",
        "get_page_svg",
        "list_fonts",
        "list_gallery",
        "get_gallery_svg",
        "list_jobs",
        "get_job_preview",
        "plot_page",
        "create_page_and_plot_polylines",
        "add_polylines_to_page_and_plot",
        "create_page_and_plot_drawing",
        "add_drawing_to_page_and_plot",
        "create_page_and_plot_text",
        "add_text_to_page_and_plot",
        "create_page_and_plot_gallery_item",
        "add_gallery_item_to_page_and_plot",
    }.issubset(names)


def test_mcp_notification_returns_no_content(client):
    token = _enable_mcp(client)
    r = client.post(
        "/mcp",
        headers=_headers(token),
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )
    assert r.status_code == 204


def test_mcp_get_status_requires_valid_token(client):
    token = _enable_mcp(client)
    r = client.get("/mcp", headers=_headers(token))
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["transport"] == "json-rpc"
    assert r.json()["tools"] >= 1


def test_mcp_tutorial_explains_safe_workflow(client):
    token = _enable_mcp(client)

    data = _call_tool(client, token, "get_mcp_tutorial")

    assert "raw G-code" in data["purpose"]
    assert "get_active_profile" in data["workflow"][0]
    assert "outside_active_profile_plot_area" in data["safety_rules"][1]
    assert "create_page_and_plot_drawing" in data["examples"]


def test_mcp_overview_explains_gcodescribe_capabilities(client):
    token = _enable_mcp(client)

    data = _call_tool(client, token, "get_mcp_overview")

    assert data["name"] == "GCodeScribe"
    assert "pen-plotter studio" in data["summary"]
    assert any("Create new pages" in item for item in data["what_you_can_do"])
    assert "MCP does not expose raw G-code" in data["important_limits"][0]
    assert "get_active_profile" in data["recommended_start"][0]


def test_mcp_call_get_active_profile(client):
    token = _enable_mcp(client)
    r = client.post(
        "/mcp",
        headers=_headers(token),
        json={
            "jsonrpc": "2.0",
            "id": "profile",
            "method": "tools/call",
            "params": {"name": "get_active_profile", "arguments": {}},
        },
    )
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["isError"] is False
    assert "Standard" in result["content"][0]["text"]


def test_mcp_printer_control_tools(monkeypatch, client):
    FakePrinterController.homes = 0
    FakePrinterController.moves = []
    FakePrinterController.pens = []
    FakePrinterController.commands = []
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)

    home = _call_tool(client, token, "printer_home", {"axes": ["x", "y", "z"]})
    move = _call_tool(client, token, "printer_move_to", {"x": 25, "y": 35})
    pen = _call_tool(client, token, "printer_pen", {"down": True})
    command = _call_tool(client, token, "printer_job_command", {"command": "pause"})

    assert home["ok"] is True
    assert move["position"]["x"] == 25
    assert pen["z"] == 1.4
    assert command == {"ok": True, "command": "pause"}
    assert FakePrinterController.homes == 1
    assert FakePrinterController.moves == [
        {"x": 25.0, "y": 35.0, "pen_up_first": True, "limit": "plot"}
    ]
    assert FakePrinterController.pens == [True]
    assert FakePrinterController.commands == ["pause"]


def test_mcp_printer_job_command_rejects_start(client):
    token = _enable_mcp(client)
    result = _call_tool_raw(client, token, "printer_job_command", {"command": "start"})
    error = json.loads(result["content"][0]["text"])
    assert result["isError"] is True
    assert "pause, resume or cancel" in error["error"]


def test_mcp_call_list_pages_and_get_page(client):
    token = _enable_mcp(client)
    pages = client.post(
        "/mcp",
        headers=_headers(token),
        json={
            "jsonrpc": "2.0",
            "id": "pages",
            "method": "tools/call",
            "params": {"name": "list_pages", "arguments": {}},
        },
    )
    assert pages.status_code == 200
    text = pages.json()["result"]["content"][0]["text"]
    assert "activeId" in text

    page_id = client.get("/api/pages").json()["activeId"]
    page = client.post(
        "/mcp",
        headers=_headers(token),
        json={
            "jsonrpc": "2.0",
            "id": "page",
            "method": "tools/call",
            "params": {"name": "get_page", "arguments": {"page_id": page_id}},
        },
    )
    assert page.status_code == 200
    assert page.json()["result"]["isError"] is False
    assert page_id in page.json()["result"]["content"][0]["text"]


def test_mcp_call_unknown_tool_returns_jsonrpc_error(client):
    token = _enable_mcp(client)
    r = client.post(
        "/mcp",
        headers=_headers(token),
        json={
            "jsonrpc": "2.0",
            "id": "bad",
            "method": "tools/call",
            "params": {"name": "does_not_exist", "arguments": {}},
        },
    )
    assert r.status_code == 200
    assert r.json()["error"]["code"] == -32602


def test_mcp_call_get_page_svg(client):
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]
    client.put(
        f"/api/pages/{page_id}",
        json={
            "objects": [
                {
                    "id": "line-1",
                    "type": "line",
                    "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
                    "cachedPolylines": [[[10, 10], [50, 50]]],
                }
            ]
        },
    )

    data = _call_tool(client, token, "get_page_svg", {"page_id": page_id})
    assert data["page_id"] == page_id
    assert data["polylines"] == [[[10, 10], [50, 50]]]
    assert data["svg"].startswith("<svg")
    assert "M10.000,10.000" in data["svg"]


def test_mcp_call_get_gallery_svg(client):
    token = _enable_mcp(client)
    svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm">'
        b'<path d="M1 1 L9 9" /></svg>'
    )
    created = client.post(
        "/api/gallery",
        files={"file": ("line.svg", svg, "image/svg+xml")},
        data={"title": "Line"},
    )
    assert created.status_code == 200
    item_id = created.json()["id"]

    data = _call_tool(client, token, "get_gallery_svg", {"item_id": item_id, "page": 1})
    assert data["item_id"] == item_id
    assert data["page"] == 1
    assert data["svg"].startswith("<svg")
    assert data["polylines"]


def test_mcp_call_get_job_preview(client):
    token = _enable_mcp(client)
    created = client.post("/api/testpattern/frame")
    assert created.status_code == 200
    filename = created.json()["filename"]

    data = _call_tool(client, token, "get_job_preview", {"filename": filename})
    assert data["filename"] == filename
    assert data["polylines"]
    assert data["svg"].startswith("<svg")


def test_mcp_create_page_and_plot_polylines(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)
    before = len(client.get("/api/pages").json()["order"])

    data = _call_tool(
        client,
        token,
        "create_page_and_plot_polylines",
        {
            "name": "MCP lines",
            "polylines": [[[10, 10], [30, 10], [30, 30]]],
        },
    )

    after = client.get("/api/pages").json()["order"]
    assert len(after) == before + 1
    assert data["ok"] is True
    assert data["page"]["name"] == "MCP lines"
    assert data["job"]["filename"] in FakePrinterController.uploads
    assert FakePrinterController.homes == 1


def test_mcp_create_page_and_plot_polylines_out_of_bounds_does_not_save(client):
    token = _enable_mcp(client)
    before = client.get("/api/pages").json()

    result = _call_tool_raw(
        client,
        token,
        "create_page_and_plot_polylines",
        {
            "name": "Too large",
            "polylines": [[[10, 10], [9999, 10]]],
        },
    )

    after = client.get("/api/pages").json()
    error = json.loads(result["content"][0]["text"])
    assert result["isError"] is True
    assert error["error"] == "outside_active_profile_plot_area"
    assert error["active_profile"]["plot_width"] == 200.0
    assert after["order"] == before["order"]
    assert after["activeId"] == before["activeId"]


def test_mcp_create_page_and_plot_drawing(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)

    data = _call_tool(
        client,
        token,
        "create_page_and_plot_drawing",
        {
            "name": "MCP pattern",
            "elements": [
                {"type": "rect", "x": 10, "y": 10, "w": 40, "h": 20},
                {"type": "circle", "cx": 30, "cy": 20, "r": 8, "segments": 16},
                {"type": "hatch", "x": 10, "y": 10, "w": 40, "h": 20, "spacing": 10},
            ],
        },
    )

    assert data["ok"] is True
    assert data["page"]["name"] == "MCP pattern"
    assert data["page"]["objects"][0]["type"] == "line"
    assert len(data["page"]["objects"][0]["cachedPolylines"]) >= 5
    assert data["job"]["filename"] in FakePrinterController.uploads
    assert FakePrinterController.homes == 1


def test_mcp_create_page_and_plot_drawing_out_of_bounds_does_not_save(client):
    token = _enable_mcp(client)
    before = client.get("/api/pages").json()

    result = _call_tool_raw(
        client,
        token,
        "create_page_and_plot_drawing",
        {
            "name": "Too large drawing",
            "elements": [{"type": "circle", "cx": 199, "cy": 100, "r": 20}],
        },
    )

    after = client.get("/api/pages").json()
    error = json.loads(result["content"][0]["text"])
    assert result["isError"] is True
    assert error["error"] == "outside_active_profile_plot_area"
    assert after["order"] == before["order"]
    assert after["activeId"] == before["activeId"]


def test_mcp_create_page_and_plot_text(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)

    data = _call_tool(
        client,
        token,
        "create_page_and_plot_text",
        {
            "name": "MCP text",
            "text": "Hi",
            "x": 10,
            "y": 10,
            "size": 12,
            "font": "sans",
        },
    )

    assert data["ok"] is True
    assert data["page"]["objects"][0]["type"] == "text"
    assert data["job"]["filename"] in FakePrinterController.uploads


def test_mcp_plot_existing_page(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]
    client.put(
        f"/api/pages/{page_id}",
        json={
            "objects": [
                {
                    "id": "line-1",
                    "type": "line",
                    "transform": {"x": 0, "y": 0, "rotation": 0, "scale": 1},
                    "cachedPolylines": [[[15, 15], [40, 15]]],
                }
            ]
        },
    )

    data = _call_tool(client, token, "plot_page", {"page_id": page_id})

    assert data["ok"] is True
    assert data["page"]["id"] == page_id
    assert data["job"]["filename"] in FakePrinterController.uploads
    assert FakePrinterController.homes == 1


def test_mcp_create_page_and_plot_gallery_item(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)
    svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm">'
        b'<path d="M1 1 L9 9" /></svg>'
    )
    created = client.post(
        "/api/gallery",
        files={"file": ("line.svg", svg, "image/svg+xml")},
        data={"title": "Line"},
    )
    assert created.status_code == 200
    item_id = created.json()["id"]

    data = _call_tool(
        client,
        token,
        "create_page_and_plot_gallery_item",
        {"item_id": item_id, "page": 1, "name": "Gallery plot", "x": 5, "y": 5, "scale": 1},
    )

    assert data["ok"] is True
    assert data["page"]["name"] == "Gallery plot"
    assert data["job"]["filename"] in FakePrinterController.uploads
    assert FakePrinterController.homes == 1


def test_mcp_add_polylines_to_page_and_plot(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]

    data = _call_tool(
        client,
        token,
        "add_polylines_to_page_and_plot",
        {"page_id": page_id, "polylines": [[[20, 20], [45, 20]]]},
    )

    page = client.get(f"/api/pages/{page_id}").json()
    assert data["ok"] is True
    assert len(page["objects"]) == 1
    assert page["objects"][0]["id"] == "mcp-lines-added"
    assert data["job"]["filename"] in FakePrinterController.uploads


def test_mcp_add_polylines_out_of_bounds_rolls_back(client):
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]
    before = client.get(f"/api/pages/{page_id}").json()

    result = _call_tool_raw(
        client,
        token,
        "add_polylines_to_page_and_plot",
        {"page_id": page_id, "polylines": [[[20, 20], [9999, 20]]]},
    )

    after = client.get(f"/api/pages/{page_id}").json()
    error = json.loads(result["content"][0]["text"])
    assert result["isError"] is True
    assert error["error"] == "outside_active_profile_plot_area"
    assert after["objects"] == before["objects"]


def test_mcp_add_drawing_to_page_and_plot(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]

    data = _call_tool(
        client,
        token,
        "add_drawing_to_page_and_plot",
        {"page_id": page_id, "elements": [{"type": "star", "cx": 40, "cy": 40, "r": 20}]},
    )

    page = client.get(f"/api/pages/{page_id}").json()
    assert data["ok"] is True
    assert len(page["objects"]) == 1
    assert page["objects"][0]["id"] == "mcp-drawing-added"
    assert data["job"]["filename"] in FakePrinterController.uploads


def test_mcp_add_drawing_out_of_bounds_rolls_back(client):
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]
    before = client.get(f"/api/pages/{page_id}").json()

    result = _call_tool_raw(
        client,
        token,
        "add_drawing_to_page_and_plot",
        {"page_id": page_id, "elements": [{"type": "rect", "x": 20, "y": 20, "w": 9999, "h": 5}]},
    )

    after = client.get(f"/api/pages/{page_id}").json()
    error = json.loads(result["content"][0]["text"])
    assert result["isError"] is True
    assert error["error"] == "outside_active_profile_plot_area"
    assert after["objects"] == before["objects"]


def test_mcp_add_text_to_page_and_plot(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]

    data = _call_tool(
        client,
        token,
        "add_text_to_page_and_plot",
        {"page_id": page_id, "text": "OK", "x": 10, "y": 10, "size": 10, "font": "sans"},
    )

    page = client.get(f"/api/pages/{page_id}").json()
    assert data["ok"] is True
    assert page["objects"][0]["type"] == "text"
    assert data["job"]["filename"] in FakePrinterController.uploads


def test_mcp_add_gallery_item_to_page_and_plot(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]
    svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm">'
        b'<path d="M1 1 L9 9" /></svg>'
    )
    created = client.post(
        "/api/gallery",
        files={"file": ("line.svg", svg, "image/svg+xml")},
        data={"title": "Line"},
    )
    item_id = created.json()["id"]

    data = _call_tool(
        client,
        token,
        "add_gallery_item_to_page_and_plot",
        {"page_id": page_id, "item_id": item_id, "x": 5, "y": 5, "scale": 1},
    )

    page = client.get(f"/api/pages/{page_id}").json()
    assert data["ok"] is True
    assert page["objects"][0]["type"] == "image"
    assert data["job"]["filename"] in FakePrinterController.uploads


def test_mcp_created_page_can_be_listed_and_deleted(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)

    created = _call_tool(
        client,
        token,
        "create_page_and_plot_polylines",
        {"name": "MCP delete me", "polylines": [[[10, 10], [20, 20]]]},
    )
    page_id = created["page"]["id"]

    listed = _call_tool(client, token, "list_mcp_pages")
    assert any(page["id"] == page_id and page["mcpCreated"] for page in listed["order"])

    deleted = _call_tool(client, token, "delete_mcp_page", {"page_id": page_id})

    assert all(page["id"] != page_id for page in deleted["order"])
    assert client.get(f"/api/pages/{page_id}").status_code == 404


def test_mcp_cannot_delete_manual_page(client):
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]

    result = _call_tool_raw(client, token, "delete_mcp_page", {"page_id": page_id})
    error = json.loads(result["content"][0]["text"])

    assert result["isError"] is True
    assert error["error"] == "not_mcp_created"
    assert client.get(f"/api/pages/{page_id}").status_code == 200


def test_mcp_cannot_delete_manual_page_after_adding_mcp_content(monkeypatch, client):
    FakePrinterController.uploads = []
    FakePrinterController.homes = 0
    monkeypatch.setattr(plotter.services, "PrinterController", FakePrinterController)
    token = _enable_mcp(client)
    page_id = client.get("/api/pages").json()["activeId"]

    _call_tool(
        client,
        token,
        "add_polylines_to_page_and_plot",
        {"page_id": page_id, "polylines": [[[10, 10], [20, 10]]]},
    )
    page = client.get(f"/api/pages/{page_id}").json()
    assert not page.get("mcp")

    result = _call_tool_raw(client, token, "delete_mcp_page", {"page_id": page_id})
    error = json.loads(result["content"][0]["text"])

    assert result["isError"] is True
    assert error["error"] == "not_mcp_created"
    assert client.get(f"/api/pages/{page_id}").status_code == 200
