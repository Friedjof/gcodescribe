from __future__ import annotations

import json
import math
import os
import secrets
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from ..config import load_settings
from ..events import hub
from ..services.settings_store import load_saved

JSONRPC_VERSION = "2.0"
MCP_PROTOCOL_VERSION = "2024-11-05"

router = APIRouter(tags=["mcp"])

ToolHandler = Callable[[dict[str, Any]], Any]


class ToolPayloadError(RuntimeError):
    def __init__(self, payload: dict):
        super().__init__(str(payload.get("message") or payload.get("error") or "Tool error"))
        self.payload = payload


def _schema(properties: dict[str, dict] | None = None, required: list[str] | None = None) -> dict:
    return {
        "type": "object",
        "properties": properties or {},
        "required": required or [],
        "additionalProperties": False,
    }


TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_printer_status",
        "description": (
            "Return the active printer backend status, including connection and job progress."
        ),
        "inputSchema": _schema(),
    },
    {
        "name": "get_printer_position",
        "description": "Return the server-side tracked plotter head position.",
        "inputSchema": _schema(),
    },
    {
        "name": "get_mcp_overview",
        "description": (
            "Return a concise overview of what GCodeScribe is, what it can do, and how MCP "
            "agents should use it safely."
        ),
        "inputSchema": _schema(),
    },
    {
        "name": "get_mcp_tutorial",
        "description": (
            "Explain how to use the GCodeScribe MCP tools safely, including the expected "
            "workflow for drawing, plotting, previewing and cleanup."
        ),
        "inputSchema": _schema(),
    },
    {
        "name": "printer_home",
        "description": "Home the plotter through the configured printer backend.",
        "inputSchema": _schema(
            {"axes": {"type": "array", "description": "Optional axes, e.g. ['x', 'y', 'z']."}},
        ),
    },
    {
        "name": "printer_move_to",
        "description": (
            "Move the head to an absolute coordinate. Defaults to the active plot area limit."
        ),
        "inputSchema": _schema(
            {
                "x": {"type": "number", "description": "Target X in printer mm."},
                "y": {"type": "number", "description": "Target Y in printer mm."},
                "limit": {"type": "string", "default": "plot", "description": "plot or bed."},
            },
            ["x", "y"],
        ),
    },
    {
        "name": "printer_pen",
        "description": "Move the pen to the calibrated up or down height.",
        "inputSchema": _schema(
            {"down": {"type": "boolean", "description": "True for pen down, false for pen up."}},
            ["down"],
        ),
    },
    {
        "name": "printer_job_command",
        "description": "Send a safe job command: pause, resume or cancel.",
        "inputSchema": _schema(
            {"command": {"type": "string", "description": "pause, resume or cancel."}},
            ["command"],
        ),
    },
    {
        "name": "get_active_profile",
        "description": "Return the active plotter profile and safety-relevant calibration values.",
        "inputSchema": _schema(),
    },
    {
        "name": "list_profiles",
        "description": "List all plotter profiles, including archived profiles.",
        "inputSchema": _schema(),
    },
    {
        "name": "list_pages",
        "description": "List designer pages with their names, active page id and profile metadata.",
        "inputSchema": _schema(),
    },
    {
        "name": "list_mcp_pages",
        "description": "List only designer pages that were created by MCP tools.",
        "inputSchema": _schema(),
    },
    {
        "name": "get_page",
        "description": "Return a designer page by id, including its objects.",
        "inputSchema": _schema(
            {"page_id": {"type": "string", "description": "Designer page id."}},
            ["page_id"],
        ),
    },
    {
        "name": "delete_mcp_page",
        "description": "Delete a designer page only if it was created by MCP.",
        "inputSchema": _schema(
            {"page_id": {"type": "string", "description": "MCP-created designer page id."}},
            ["page_id"],
        ),
    },
    {
        "name": "get_page_svg",
        "description": "Return an SVG preview of the plottable paths on a designer page.",
        "inputSchema": _schema(
            {"page_id": {"type": "string", "description": "Designer page id."}},
            ["page_id"],
        ),
    },
    {
        "name": "list_fonts",
        "description": "List text fonts and handwriting stroke fonts available for MCP text tools.",
        "inputSchema": _schema(),
    },
    {
        "name": "list_gallery",
        "description": "List gallery items available for preview/insertion.",
        "inputSchema": _schema(
            {
                "include_archived": {"type": "boolean", "default": True},
                "uploader": {"type": "string", "description": "Optional uploader filter."},
            },
        ),
    },
    {
        "name": "get_gallery_item",
        "description": "Return a gallery item by id.",
        "inputSchema": _schema(
            {"item_id": {"type": "string", "description": "Gallery item id."}},
            ["item_id"],
        ),
    },
    {
        "name": "get_gallery_svg",
        "description": "Return an SVG preview for one gallery item page.",
        "inputSchema": _schema(
            {
                "item_id": {"type": "string", "description": "Gallery item id."},
                "page": {"type": "integer", "default": 1},
                "max_points": {"type": "integer", "default": 20000},
            },
            ["item_id"],
        ),
    },
    {
        "name": "list_jobs",
        "description": "List generated G-code jobs with profile and safety status.",
        "inputSchema": _schema(),
    },
    {
        "name": "get_job_preview",
        "description": (
            "Return parsed draw/travel polylines and an SVG preview for a generated job."
        ),
        "inputSchema": _schema(
            {"filename": {"type": "string", "description": "Job filename."}},
            ["filename"],
        ),
    },
    {
        "name": "plot_page",
        "description": (
            "Generate and immediately plot an existing designer page. The page must belong "
            "to the active profile."
        ),
        "inputSchema": _schema(
            {"page_id": {"type": "string", "description": "Designer page id."}},
            ["page_id"],
        ),
    },
    {
        "name": "create_page_and_plot_polylines",
        "description": (
            "Create a new designer page from plot-area polylines and immediately plot it. "
            "If anything is outside the active profile border, nothing is saved or plotted."
        ),
        "inputSchema": _schema(
            {
                "name": {"type": "string", "description": "Name for the new designer page."},
                "polylines": {
                    "type": "array",
                    "description": "Polylines in mm relative to the active plot area.",
                },
            },
            ["polylines"],
        ),
    },
    {
        "name": "add_polylines_to_page_and_plot",
        "description": (
            "Add plot-area polylines to an existing designer page and immediately plot the "
            "updated page. If the resulting page exceeds the active border, nothing changes."
        ),
        "inputSchema": _schema(
            {
                "page_id": {"type": "string", "description": "Designer page id."},
                "polylines": {
                    "type": "array",
                    "description": "Polylines in mm relative to the active plot area.",
                },
            },
            ["page_id", "polylines"],
        ),
    },
    {
        "name": "create_page_and_plot_drawing",
        "description": (
            "Create a new page from drawing elements and immediately plot it. Elements may be "
            "polyline, line, rect, circle, ellipse, arc, polygon, star, spiral, wave, grid "
            "or hatch."
        ),
        "inputSchema": _schema(
            {
                "name": {"type": "string", "description": "Name for the new designer page."},
                "elements": {"type": "array", "description": "Drawing elements in plot-area mm."},
            },
            ["elements"],
        ),
    },
    {
        "name": "add_drawing_to_page_and_plot",
        "description": (
            "Add drawing elements to an existing page and immediately plot the updated page. "
            "If the resulting page exceeds the active border, nothing changes."
        ),
        "inputSchema": _schema(
            {
                "page_id": {"type": "string", "description": "Designer page id."},
                "elements": {"type": "array", "description": "Drawing elements in plot-area mm."},
            },
            ["page_id", "elements"],
        ),
    },
    {
        "name": "create_page_and_plot_text",
        "description": (
            "Create a new designer page containing text and immediately plot it. "
            "Text is placed in plot-area mm and rejected if it exceeds the active border."
        ),
        "inputSchema": _schema(
            {
                "name": {"type": "string", "description": "Name for the new designer page."},
                "text": {"type": "string", "description": "Text to render and plot."},
                "x": {"type": "number", "description": "Left position in plot-area mm."},
                "y": {"type": "number", "description": "Top position in plot-area mm."},
                "size": {"type": "number", "description": "Text size in mm."},
                "font": {"type": "string", "description": "Font id from list_fonts."},
                "connect_spaces": {"type": "boolean", "default": False},
                "seed": {"type": "integer", "default": 0},
            },
            ["text", "x", "y", "size", "font"],
        ),
    },
    {
        "name": "add_text_to_page_and_plot",
        "description": (
            "Add text to an existing designer page and immediately plot the updated page. "
            "If the resulting page exceeds the active border, nothing changes."
        ),
        "inputSchema": _schema(
            {
                "page_id": {"type": "string", "description": "Designer page id."},
                "text": {"type": "string", "description": "Text to render and plot."},
                "x": {"type": "number", "description": "Left position in plot-area mm."},
                "y": {"type": "number", "description": "Top position in plot-area mm."},
                "size": {"type": "number", "description": "Text size in mm."},
                "font": {"type": "string", "description": "Font id from list_fonts."},
                "connect_spaces": {"type": "boolean", "default": False},
                "seed": {"type": "integer", "default": 0},
            },
            ["page_id", "text", "x", "y", "size", "font"],
        ),
    },
    {
        "name": "create_page_and_plot_gallery_item",
        "description": (
            "Place a gallery item page on a new designer page and immediately plot it. "
            "Placement is rejected if it exceeds the active profile border."
        ),
        "inputSchema": _schema(
            {
                "item_id": {"type": "string", "description": "Gallery item id."},
                "page": {"type": "integer", "default": 1},
                "name": {"type": "string", "description": "Name for the new designer page."},
                "x": {"type": "number", "description": "Left position in plot-area mm."},
                "y": {"type": "number", "description": "Top position in plot-area mm."},
                "scale": {"type": "number", "default": 1},
            },
            ["item_id", "x", "y"],
        ),
    },
    {
        "name": "add_gallery_item_to_page_and_plot",
        "description": (
            "Place a gallery item page on an existing designer page and immediately plot the "
            "updated page. If the resulting page exceeds the active border, nothing changes."
        ),
        "inputSchema": _schema(
            {
                "page_id": {"type": "string", "description": "Designer page id."},
                "item_id": {"type": "string", "description": "Gallery item id."},
                "page": {"type": "integer", "default": 1},
                "x": {"type": "number", "description": "Left position in plot-area mm."},
                "y": {"type": "number", "description": "Top position in plot-area mm."},
                "scale": {"type": "number", "default": 1},
            },
            ["page_id", "item_id", "x", "y"],
        ),
    },
]


def _settings():
    return load_settings(load_saved())


def _require_mcp_enabled(authorization: str | None) -> None:
    if os.environ.get("GCODESCRIBE_PACKAGING", "").lower() == "flatpak":
        raise HTTPException(status_code=404, detail="MCP is not available in desktop mode.")

    cfg = _settings().mcp
    if not cfg.enabled:
        raise HTTPException(status_code=404, detail="MCP is disabled.")
    if not cfg.token:
        raise HTTPException(status_code=401, detail="MCP token is not configured.")

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(token, cfg.token):
        raise HTTPException(status_code=401, detail="Invalid MCP token.")


def _result(request_id: Any, result: dict) -> dict:
    return {"jsonrpc": JSONRPC_VERSION, "id": request_id, "result": result}


def _error(request_id: Any, code: int, message: str) -> dict:
    return {
        "jsonrpc": JSONRPC_VERSION,
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _initialize_result() -> dict:
    return {
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "gcodescribe", "version": "0.4.0"},
    }


def _tools_list_result() -> dict:
    return {"tools": TOOLS}


def _json_content(data: Any, *, is_error: bool = False) -> dict:
    return {
        "content": [
            {"type": "text", "text": json.dumps(data, ensure_ascii=False, indent=2, default=str)}
        ],
        "isError": is_error,
    }


def _require_arg(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"missing required string argument: {key}")
    return value


def _int_arg(args: dict[str, Any], key: str, default: int, *, lo: int, hi: int) -> int:
    raw = args.get(key, default)
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be an integer") from exc
    return max(lo, min(value, hi))


def _float_arg(args: dict[str, Any], key: str, default: float | None = None) -> float:
    raw = args.get(key, default)
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be a number") from exc
    if not (value == value and abs(value) != float("inf")):
        raise ValueError(f"{key} must be finite")
    return value


def _profile_bounds_error(cal, bounds: list[float]) -> dict:
    return {
        "error": "outside_active_profile_plot_area",
        "message": "Drawing exceeds the active profile plot area; nothing was saved or plotted.",
        "active_profile": {
            "plot_width": cal.plot_width,
            "plot_height": cal.plot_height,
            "origin_x": cal.origin_x,
            "origin_y": cal.origin_y,
        },
        "drawing_bounds": {
            "min_x": bounds[0],
            "min_y": bounds[1],
            "max_x": bounds[2],
            "max_y": bounds[3],
        },
    }


def _coerce_polylines(raw: Any) -> list[list[list[float]]]:
    if not isinstance(raw, list):
        raise ValueError("polylines must be an array")
    out: list[list[list[float]]] = []
    total = 0
    for line in raw:
        if not isinstance(line, list):
            raise ValueError("each polyline must be an array")
        pts: list[list[float]] = []
        for point in line:
            if not isinstance(point, list | tuple) or len(point) < 2:
                raise ValueError("each point must be [x, y]")
            x = float(point[0])
            y = float(point[1])
            if not (x == x and y == y and abs(x) != float("inf") and abs(y) != float("inf")):
                raise ValueError("points must be finite")
            pts.append([round(x, 3), round(y, 3)])
        if len(pts) >= 2:
            out.append(pts)
            total += len(pts)
    if not out:
        raise ValueError("at least one polyline with two points is required")
    if total > 50000:
        raise ValueError("too many points; maximum is 50000")
    return out


def _num(data: dict[str, Any], key: str, default: float | None = None) -> float:
    raw = data.get(key, default)
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be a number") from exc
    if not math.isfinite(value):
        raise ValueError(f"{key} must be finite")
    return value


def _segments(data: dict[str, Any], default: int = 96) -> int:
    return max(4, min(int(_num(data, "segments", default)), 720))


def _ellipse_points(
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    *,
    start: float = 0.0,
    end: float = 360.0,
    segments: int = 96,
    close: bool = False,
) -> list[list[float]]:
    if rx <= 0 or ry <= 0:
        raise ValueError("radius values must be greater than 0")
    a0 = math.radians(start)
    a1 = math.radians(end)
    pts = []
    for i in range(segments + 1):
        angle = a0 + (a1 - a0) * i / segments
        pts.append(
            [
                round(cx + math.cos(angle) * rx, 3),
                round(cy + math.sin(angle) * ry, 3),
            ]
        )
    if close and pts[0] != pts[-1]:
        pts.append(pts[0])
    return pts


def _drawing_element_polylines(element: dict[str, Any]) -> list[list[list[float]]]:
    kind = str(element.get("type") or "").lower()
    if kind == "polyline":
        return _coerce_polylines([element.get("points")])
    if kind == "line":
        return [
            [
                [_num(element, "x1"), _num(element, "y1")],
                [_num(element, "x2"), _num(element, "y2")],
            ]
        ]
    if kind == "rect":
        x, y, w, h = (
            _num(element, "x"),
            _num(element, "y"),
            _num(element, "w"),
            _num(element, "h"),
        )
        return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]
    if kind == "circle":
        pts = _ellipse_points(
            _num(element, "cx"),
            _num(element, "cy"),
            _num(element, "r"),
            _num(element, "r"),
            segments=_segments(element),
            close=True,
        )
        return [pts]
    if kind == "ellipse":
        pts = _ellipse_points(
            _num(element, "cx"),
            _num(element, "cy"),
            _num(element, "rx"),
            _num(element, "ry"),
            segments=_segments(element),
            close=True,
        )
        return [pts]
    if kind == "arc":
        radius = _num(element, "r", 0)
        pts = _ellipse_points(
            _num(element, "cx"),
            _num(element, "cy"),
            _num(element, "rx", radius),
            _num(element, "ry", radius),
            start=_num(element, "start", 0),
            end=_num(element, "end", 180),
            segments=_segments(element),
            close=False,
        )
        return [pts]
    if kind in ("polygon", "star"):
        cx, cy = _num(element, "cx"), _num(element, "cy")
        n = max(3, min(int(_num(element, "points" if kind == "star" else "sides", 5)), 200))
        rot = math.radians(_num(element, "rotation", -90))
        outer = _num(element, "r")
        pts = []
        count = n * 2 if kind == "star" else n
        inner = _num(element, "inner_r", outer * 0.5)
        for i in range(count):
            radius = outer if kind == "polygon" or i % 2 == 0 else inner
            a = rot + 2 * math.pi * i / count
            pts.append([round(cx + math.cos(a) * radius, 3), round(cy + math.sin(a) * radius, 3)])
        pts.append(pts[0])
        return [pts]
    if kind == "spiral":
        cx, cy = _num(element, "cx"), _num(element, "cy")
        turns = max(0.25, _num(element, "turns", 3))
        steps = max(8, min(int(_num(element, "segments", turns * 80)), 2000))
        r0, r1 = _num(element, "r0", 0), _num(element, "r", 50)
        pts = []
        for i in range(steps + 1):
            t = i / steps
            a = 2 * math.pi * turns * t + math.radians(_num(element, "rotation", 0))
            r = r0 + (r1 - r0) * t
            pts.append([round(cx + math.cos(a) * r, 3), round(cy + math.sin(a) * r, 3)])
        return [pts]
    if kind == "wave":
        x, y, length = _num(element, "x"), _num(element, "y"), _num(element, "length")
        amp, cycles = _num(element, "amplitude"), _num(element, "cycles", 3)
        steps = max(8, min(int(_num(element, "segments", cycles * 48)), 2000))
        pts = []
        for i in range(steps + 1):
            pts.append(
                [
                    round(x + length * i / steps, 3),
                    round(y + math.sin(2 * math.pi * cycles * i / steps) * amp, 3),
                ]
            )
        return [pts]
    if kind in ("grid", "hatch"):
        x, y, w, h = _num(element, "x"), _num(element, "y"), _num(element, "w"), _num(element, "h")
        spacing = max(_num(element, "spacing", 10), 0.1)
        lines = []
        if kind == "grid" or str(element.get("direction", "horizontal")) != "vertical":
            yy = y
            while yy <= y + h + 1e-6:
                lines.append([[x, round(yy, 3)], [x + w, round(yy, 3)]])
                yy += spacing
        if kind == "grid" or str(element.get("direction")) == "vertical":
            xx = x
            while xx <= x + w + 1e-6:
                lines.append([[round(xx, 3), y], [round(xx, 3), y + h]])
                xx += spacing
        return lines
    raise ValueError(f"unknown drawing element type: {kind}")


def _drawing_polylines(raw: Any) -> list[list[list[float]]]:
    if not isinstance(raw, list):
        raise ValueError("elements must be an array")
    lines: list[list[list[float]]] = []
    for element in raw:
        if not isinstance(element, dict):
            raise ValueError("each drawing element must be an object")
        lines.extend(_drawing_element_polylines(element))
    return _coerce_polylines(lines)


def _bounds(polylines: list[list[list[float]]]) -> list[float]:
    xs = [pt[0] for line in polylines for pt in line]
    ys = [pt[1] for line in polylines for pt in line]
    return [min(xs), min(ys), max(xs), max(ys)]


def _validate_inside_plot(polylines: list[list[list[float]]], cal) -> None:
    b = _bounds(polylines)
    eps = 0.001
    if b[0] < -eps or b[1] < -eps or b[2] > cal.plot_width + eps or b[3] > cal.plot_height + eps:
        raise ToolPayloadError(_profile_bounds_error(cal, b))


def _identity_transform() -> dict:
    return {"x": 0, "y": 0, "rotation": 0, "scale": 1}


def _next_z(page: dict) -> int:
    values = [float(obj.get("zOrder", i)) for i, obj in enumerate(page.get("objects") or [])]
    return int(max(values, default=-1) + 1)


def _line_object(polylines: list[list[list[float]]], *, obj_id: str = "mcp-lines") -> dict:
    return {
        "id": obj_id,
        "type": "line",
        "transform": _identity_transform(),
        "cachedPolylines": polylines,
        "data": {"source": "mcp"},
    }


def _text_object(
    polylines: list[list[list[float]]],
    *,
    text: str,
    font: str,
    size: float,
    seed: int,
    obj_id: str = "mcp-text",
) -> dict:
    return {
        "id": obj_id,
        "type": "text",
        "transform": _identity_transform(),
        "cachedPolylines": polylines,
        "data": {
            "source": "mcp",
            "text": text,
            "font": font,
            "size": size,
            "seed": seed,
        },
    }


def _gallery_object(
    polylines: list[list[list[float]]],
    *,
    item_id: str,
    page: int,
    x: float,
    y: float,
    scale: float,
    obj_id: str = "mcp-gallery",
) -> dict:
    return {
        "id": obj_id,
        "type": "image",
        "transform": _identity_transform(),
        "cachedPolylines": polylines,
        "data": {
            "source": "mcp-gallery",
            "item_id": item_id,
            "page": page,
            "x": x,
            "y": y,
            "scale": scale,
        },
    }


def _require_printer_ready() -> dict:
    from ..services import PrinterController
    from ..services.errors import ServiceError

    ctrl = PrinterController()
    status = ctrl.status()
    if not status.get("online"):
        raise ServiceError("Printer is not online; nothing was saved or plotted.")
    return {"controller": ctrl, "status": status}


def _plot_existing_page(page: dict, profile: dict, cal) -> dict:
    from ..scene import save_scene_job
    from ..services.profiles import profile_meta

    active = profile_meta(profile)
    page_profile_mismatch = (
        page.get("profileId") != active["id"]
        or page.get("profileFingerprint") != active["fingerprint"]
    )
    if page_profile_mismatch:
        raise ToolPayloadError(
            {
                "error": "page_profile_mismatch",
                "message": "Page does not match the active profile; nothing was plotted.",
                "active_profile": active,
                "page_profile": {
                    "id": page.get("profileId"),
                    "name": page.get("profileName"),
                    "fingerprint": page.get("profileFingerprint"),
                },
            }
        )
    ready = _require_printer_ready()
    ctrl = ready["controller"]
    path = save_scene_job(page, cal, profile=active)
    try:
        ctrl.home()
        upload = ctrl.client.upload(path, start=True)
    except Exception:
        from ..jobmeta import delete_job_meta

        path.unlink(missing_ok=True)
        delete_job_meta(path)
        raise
    return {
        "ok": True,
        "page": {"id": page.get("id"), "name": page.get("name")},
        "job": {"filename": path.name, "upload": upload},
        "printer": ready["status"],
    }


def _create_page_job_and_plot(name: str, objects: list[dict], profile: dict, cal) -> dict:
    from ..document import get_document_store
    from ..jobmeta import delete_job_meta
    from ..scene import save_scene_job
    from ..services.profiles import profile_meta

    ready = _require_printer_ready()
    ctrl = ready["controller"]
    store = get_document_store()
    page = store.create_page(
        name,
        profile=profile_meta(profile),
        mcp={"created": True, "createdAt": time.time(), "tool": "mcp"},
    )
    path: Path | None = None
    try:
        page = store.save_page(page["id"], {"objects": objects})
        path = save_scene_job(page, cal, profile=profile_meta(profile))
        ctrl.home()
        upload = ctrl.client.upload(path, start=True)
        return {
            "ok": True,
            "page": page,
            "job": {"filename": path.name, "upload": upload},
            "printer": ready["status"],
        }
    except Exception:
        store.delete_page(page["id"])
        if path is not None:
            path.unlink(missing_ok=True)
            delete_job_meta(path)
        raise


def _update_page_and_plot(page: dict, obj: dict, profile: dict, cal) -> dict:
    from ..document import get_document_store

    store = get_document_store()
    original_objects = page.get("objects") or []
    obj = {**obj, "zOrder": _next_z(page)}
    updated = {**page, "objects": [*original_objects, obj]}
    page_polylines_checked(updated, cal)
    saved = store.save_page(page["id"], {"objects": updated["objects"]})
    try:
        result = _plot_existing_page(saved, profile, cal)
    except Exception:
        store.save_page(page["id"], {"objects": original_objects})
        raise
    result["page"] = saved
    return result


def _active_profile_and_cal() -> tuple[dict, Any]:
    from ..calibration import Calibration
    from ..services.profiles import ProfileService

    profile = ProfileService().active()
    return profile, Calibration().merged(profile["calibration"])


def _render_text_polylines(args: dict[str, Any]) -> tuple[list[list[list[float]]], dict]:
    from ..services.stroke_fonts import StrokeFontService
    from ..singleline import text_polylines

    text = _require_arg(args, "text")
    font = _require_arg(args, "font")
    x = _float_arg(args, "x")
    y = _float_arg(args, "y")
    size = _float_arg(args, "size")
    if size <= 0:
        raise ValueError("size must be greater than 0")
    seed = _int_arg(args, "seed", 0, lo=0, hi=2_147_483_647)
    connect_spaces = bool(args.get("connect_spaces", False))

    if font.startswith("stroke-"):
        rendered = StrokeFontService().render(font, text, size, seed=seed)
        local = rendered.polylines
    else:
        local = text_polylines(text, font=font, size=size, connect_spaces=connect_spaces)
    polylines = _coerce_polylines([[[px + x, py + y] for px, py in line] for line in local])
    meta = {"text": text, "font": font, "size": size, "seed": seed}
    return polylines, meta


def _placed_gallery_polylines(args: dict[str, Any]) -> tuple[list[list[list[float]]], dict]:
    from ..services.gallery import GalleryService

    item_id = _require_arg(args, "item_id")
    page = _int_arg(args, "page", 1, lo=1, hi=999)
    x = _float_arg(args, "x")
    y = _float_arg(args, "y")
    scale = _float_arg(args, "scale", 1.0)
    if scale <= 0:
        raise ValueError("scale must be greater than 0")
    preview = GalleryService().preview(item_id, page=page, max_points=40000)
    source_polylines = _coerce_polylines(preview.get("polylines") or [])
    polylines = [
        [[round(px * scale + x, 3), round(py * scale + y, 3)] for px, py in line]
        for line in source_polylines
    ]
    return polylines, {"item_id": item_id, "page": page, "x": x, "y": y, "scale": scale}


def _svg_path(polylines: list[list[list[float]]]) -> str:
    parts: list[str] = []
    for line in polylines:
        if len(line) < 2:
            continue
        coords = []
        for point in line:
            if len(point) < 2:
                continue
            coords.append(f"{float(point[0]):.3f},{float(point[1]):.3f}")
        if len(coords) >= 2:
            parts.append("M" + " L".join(coords))
    return " ".join(parts)


def _polylines_svg(
    polylines: list[list[list[float]]],
    *,
    width: float,
    height: float,
    title: str,
    travels: list[list[list[float]]] | None = None,
) -> str:
    width = max(float(width), 1.0)
    height = max(float(height), 1.0)
    draw_d = _svg_path(polylines)
    travel_d = _svg_path(travels or [])
    travel = (
        f'<path d="{escape(travel_d)}" fill="none" stroke="#9aa0a6" '
        'stroke-width="0.2" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" />'
        if travel_d
        else ""
    )
    draw = (
        f'<path d="{escape(draw_d)}" fill="none" stroke="#111" stroke-width="0.35" '
        'stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />'
        if draw_d
        else ""
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.3f}mm" '
        f'height="{height:.3f}mm" viewBox="0 0 {width:.3f} {height:.3f}">'
        f"<title>{escape(title)}</title>"
        '<rect x="0" y="0" width="100%" height="100%" fill="white" />'
        f"{travel}{draw}</svg>"
    )


def _tool_get_printer_status(_: dict[str, Any]) -> dict:
    from ..services import PrinterController

    return PrinterController().status()


def _tool_get_printer_position(_: dict[str, Any]) -> dict:
    from ..services import PrinterController

    return PrinterController().position()


def _tool_get_mcp_overview(_: dict[str, Any]) -> dict:
    return {
        "name": "GCodeScribe",
        "summary": (
            "GCodeScribe is a browser-based pen-plotter studio. It converts, generates, "
            "places, previews and plots line artwork through calibrated printer profiles."
        ),
        "what_you_can_do": [
            "Inspect the active plotter profile, plot area, printer status and position.",
            "List, inspect and preview designer pages as SVG or plottable polylines.",
            "Create new pages from polylines, drawing primitives, text or gallery items.",
            "Add safe MCP-generated content to existing pages and immediately plot them.",
            "Preview existing generated jobs and list available fonts or gallery assets.",
            "Home the plotter, move within configured limits, lift/lower the pen, and pause, "
            "resume or cancel jobs.",
            "Clean up pages that were created by MCP tools, while leaving manual pages protected.",
        ],
        "important_limits": [
            "MCP does not expose raw G-code or raw serial commands.",
            "All drawing coordinates are millimeters relative to the active plot area.",
            "Anything outside the active profile plot area is rejected before saving or plotting.",
            "Existing pages must match the active profile id and fingerprint before plotting.",
            "Only MCP-created pages can be deleted through MCP.",
            "Every create/add drawing operation immediately plots after validation succeeds.",
        ],
        "recommended_start": [
            "Call get_active_profile to learn the available plot width and height.",
            "Call get_mcp_tutorial for the detailed safe workflow and drawing element examples.",
            "Use get_page_svg, get_gallery_svg or get_job_preview when you need visual context.",
            "Use create_page_and_plot_drawing for new free-form drawings or patterns.",
            "Use add_drawing_to_page_and_plot only after inspecting the target page.",
        ],
    }


def _tool_get_mcp_tutorial(_: dict[str, Any]) -> dict:
    return {
        "purpose": (
            "Use MCP to inspect GCodeScribe state, create or update designer pages, and "
            "immediately plot through the configured printer backend. The MCP surface is "
            "intentionally safe: it does not expose raw G-code or raw serial commands."
        ),
        "workflow": [
            "Call get_active_profile first and design only within plot_width x plot_height.",
            "Use preview/read tools such as list_pages, get_page, get_page_svg, list_gallery, "
            "get_gallery_svg and get_job_preview when you need context.",
            "For free drawing, prefer create_page_and_plot_drawing or "
            "add_drawing_to_page_and_plot.",
            "For exact existing paths, use create_page_and_plot_polylines or "
            "add_polylines_to_page_and_plot.",
            "For text or gallery insertion, use the dedicated text/gallery tools.",
            "Every create/add tool validates bounds and immediately plots if validation succeeds.",
        ],
        "safety_rules": [
            "Coordinates are millimeters relative to the active plot area origin.",
            "Anything outside the active profile plot area fails with "
            "outside_active_profile_plot_area.",
            "Out-of-bounds failures do not save page changes and do not plot.",
            "Existing pages must match the active profile id and fingerprint before plotting.",
            "MCP can delete only pages created by MCP; manual pages are protected.",
            "printer_job_command supports only pause, resume and cancel.",
        ],
        "drawing_elements": {
            "polyline": {"type": "polyline", "points": [[10, 10], [30, 10], [30, 30]]},
            "line": {"type": "line", "x1": 10, "y1": 10, "x2": 50, "y2": 10},
            "rect": {"type": "rect", "x": 10, "y": 10, "w": 40, "h": 20},
            "circle": {"type": "circle", "cx": 50, "cy": 50, "r": 20},
            "ellipse": {"type": "ellipse", "cx": 50, "cy": 50, "rx": 30, "ry": 15},
            "arc": {"type": "arc", "cx": 50, "cy": 50, "r": 25, "start": 0, "end": 180},
            "polygon": {"type": "polygon", "cx": 50, "cy": 50, "sides": 6, "r": 25},
            "star": {"type": "star", "cx": 50, "cy": 50, "points": 5, "r": 25, "inner_r": 12},
            "spiral": {"type": "spiral", "cx": 50, "cy": 50, "turns": 4, "r": 35},
            "wave": {"type": "wave", "x": 10, "y": 40, "length": 120, "amplitude": 10},
            "grid": {"type": "grid", "x": 10, "y": 10, "w": 80, "h": 50, "spacing": 10},
            "hatch": {"type": "hatch", "x": 10, "y": 10, "w": 80, "h": 50, "spacing": 5},
        },
        "examples": {
            "create_page_and_plot_drawing": {
                "name": "MCP pattern",
                "elements": [
                    {"type": "rect", "x": 10, "y": 10, "w": 80, "h": 50},
                    {"type": "circle", "cx": 50, "cy": 35, "r": 20},
                    {"type": "hatch", "x": 10, "y": 10, "w": 80, "h": 50, "spacing": 5},
                ],
            },
            "add_drawing_to_page_and_plot": {
                "page_id": "existing-page-id",
                "elements": [{"type": "wave", "x": 10, "y": 80, "length": 120, "amplitude": 8}],
            },
        },
    }


def _tool_printer_home(args: dict[str, Any]) -> dict:
    from ..services import PrinterController

    axes_raw = args.get("axes")
    axes = None
    if axes_raw is not None:
        if not isinstance(axes_raw, list) or not all(isinstance(axis, str) for axis in axes_raw):
            raise ValueError("axes must be an array of strings")
        axes = axes_raw
    return {"ok": True, "position": PrinterController().home(axes)}


def _tool_printer_move_to(args: dict[str, Any]) -> dict:
    from ..services import PrinterController

    x = _float_arg(args, "x")
    y = _float_arg(args, "y")
    limit = args.get("limit") or "plot"
    if limit not in ("plot", "bed"):
        raise ValueError("limit must be 'plot' or 'bed'")
    return {
        "ok": True,
        "position": PrinterController().move_to(x, y, pen_up_first=True, limit=limit),
    }


def _tool_printer_pen(args: dict[str, Any]) -> dict:
    from ..services import PrinterController

    down = args.get("down")
    if not isinstance(down, bool):
        raise ValueError("down must be a boolean")
    return {"ok": True, **PrinterController().pen(down)}


def _tool_printer_job_command(args: dict[str, Any]) -> dict:
    from ..services import PrinterController

    command = _require_arg(args, "command")
    if command not in ("pause", "resume", "cancel"):
        raise ValueError("command must be pause, resume or cancel")
    PrinterController().client.job_command(command)
    return {"ok": True, "command": command}


def _tool_get_active_profile(_: dict[str, Any]) -> dict:
    from ..services.profiles import ProfileService

    return ProfileService().active()


def _tool_list_profiles(_: dict[str, Any]) -> list[dict]:
    from ..services.profiles import ProfileService

    return ProfileService().list(include_archived=True)


def _tool_list_pages(_: dict[str, Any]) -> dict:
    from ..document import get_document_store

    return get_document_store().list_pages()


def _tool_list_mcp_pages(_: dict[str, Any]) -> dict:
    from ..document import get_document_store

    index = get_document_store().list_pages()
    return {
        "activeId": index.get("activeId"),
        "order": [page for page in index.get("order", []) if page.get("mcpCreated")],
    }


def _tool_get_page(args: dict[str, Any]) -> dict:
    from ..document import get_document_store
    from ..services.errors import ServiceError

    page_id = _require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    return page


def _tool_delete_mcp_page(args: dict[str, Any]) -> dict:
    from ..document import get_document_store
    from ..services.errors import ServiceError

    page_id = _require_arg(args, "page_id")
    store = get_document_store()
    page = store.get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    if not (page.get("mcp") or {}).get("created"):
        raise ToolPayloadError(
            {
                "error": "not_mcp_created",
                "message": "Only pages created by MCP can be deleted through MCP.",
                "page_id": page_id,
                "page_name": page.get("name"),
            }
        )
    return store.delete_page(page_id)


def _tool_get_page_svg(args: dict[str, Any]) -> dict:
    from ..calibration import Calibration
    from ..document import get_document_store
    from ..scene import page_polylines
    from ..services.errors import ServiceError
    from ..services.profiles import ProfileService

    page_id = _require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    profile = ProfileService().active()
    cal = Calibration().merged(profile["calibration"])
    polylines = page_polylines(page)
    return {
        "page_id": page_id,
        "name": page.get("name"),
        "width": cal.plot_width,
        "height": cal.plot_height,
        "polylines": polylines,
        "svg": _polylines_svg(
            polylines,
            width=cal.plot_width,
            height=cal.plot_height,
            title=str(page.get("name") or page_id),
        ),
    }


def _tool_list_fonts(_: dict[str, Any]) -> dict:
    from ..services.fonts import list_fonts
    from ..services.stroke_fonts import StrokeFontService

    return {
        "fonts": [font.__dict__ for font in list_fonts()],
        "strokeFonts": StrokeFontService().list(),
    }


def _tool_list_gallery(args: dict[str, Any]) -> list[dict]:
    from ..services.gallery import GalleryService

    include_archived = bool(args.get("include_archived", True))
    uploader = args.get("uploader")
    if uploader is not None and not isinstance(uploader, str):
        raise ValueError("uploader must be a string")
    return GalleryService().list(include_archived=include_archived, uploader=uploader)


def _tool_get_gallery_item(args: dict[str, Any]) -> dict:
    from ..services.gallery import GalleryService

    return GalleryService().get(_require_arg(args, "item_id"))


def _tool_get_gallery_svg(args: dict[str, Any]) -> dict:
    from ..services.gallery import GalleryService

    item_id = _require_arg(args, "item_id")
    page = _int_arg(args, "page", 1, lo=1, hi=999)
    max_points = _int_arg(args, "max_points", 20000, lo=100, hi=40000)
    preview = GalleryService().preview(item_id, page=page, max_points=max_points)
    polylines = preview.get("polylines") or []
    width = float(preview.get("width") or 1.0)
    height = float(preview.get("height") or 1.0)
    return {
        "item_id": item_id,
        "page": page,
        "width": width,
        "height": height,
        "polylines": polylines,
        "svg": _polylines_svg(
            polylines,
            width=width,
            height=height,
            title=f"gallery {item_id} page {page}",
        ),
    }


def _tool_list_jobs(_: dict[str, Any]) -> list[dict]:
    from ..web.routes.jobs import list_jobs

    return [job.model_dump() for job in list_jobs()]


def _tool_get_job_preview(args: dict[str, Any]) -> dict:
    from ..gcode_preview import parse_gcode
    from ..storage import jobs_dir

    filename = Path(_require_arg(args, "filename")).name
    path = jobs_dir() / filename
    if not path.exists():
        raise FileNotFoundError(f"Job nicht gefunden: {filename}")
    preview = parse_gcode(path)
    bounds = preview.get("bounds") or [0, 0, 1, 1]
    width = max(float(bounds[2]) - min(float(bounds[0]), 0.0), 1.0)
    height = max(float(bounds[3]) - min(float(bounds[1]), 0.0), 1.0)
    return {
        "filename": filename,
        **preview,
        "svg": _polylines_svg(
            preview.get("polylines") or [],
            travels=preview.get("travels") or [],
            width=width,
            height=height,
            title=filename,
        ),
    }


def _tool_plot_page(args: dict[str, Any]) -> dict:
    from ..calibration import Calibration
    from ..document import get_document_store
    from ..services.errors import ServiceError
    from ..services.profiles import ProfileService

    page_id = _require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    profile = ProfileService().active()
    cal = Calibration().merged(profile["calibration"])
    page_polylines_checked(page, cal)
    return _plot_existing_page(page, profile, cal)


def page_polylines_checked(page: dict, cal) -> list[list[list[float]]]:
    from ..scene import page_polylines

    polylines = page_polylines(page)
    if not polylines:
        raise ValueError("page contains no plottable lines")
    _validate_inside_plot(polylines, cal)
    return polylines


def _tool_create_page_and_plot_polylines(args: dict[str, Any]) -> dict:
    profile, cal = _active_profile_and_cal()
    polylines = _coerce_polylines(args.get("polylines"))
    _validate_inside_plot(polylines, cal)
    name = str(args.get("name") or "MCP drawing")[:80]
    return _create_page_job_and_plot(name, [_line_object(polylines)], profile, cal)


def _tool_add_polylines_to_page_and_plot(args: dict[str, Any]) -> dict:
    from ..document import get_document_store
    from ..services.errors import ServiceError

    profile, cal = _active_profile_and_cal()
    page_id = _require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    polylines = _coerce_polylines(args.get("polylines"))
    obj = _line_object(polylines, obj_id="mcp-lines-added")
    return _update_page_and_plot(page, obj, profile, cal)


def _tool_create_page_and_plot_drawing(args: dict[str, Any]) -> dict:
    profile, cal = _active_profile_and_cal()
    polylines = _drawing_polylines(args.get("elements"))
    _validate_inside_plot(polylines, cal)
    name = str(args.get("name") or "MCP drawing")[:80]
    return _create_page_job_and_plot(name, [_line_object(polylines)], profile, cal)


def _tool_add_drawing_to_page_and_plot(args: dict[str, Any]) -> dict:
    from ..document import get_document_store
    from ..services.errors import ServiceError

    profile, cal = _active_profile_and_cal()
    page_id = _require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    polylines = _drawing_polylines(args.get("elements"))
    obj = _line_object(polylines, obj_id="mcp-drawing-added")
    return _update_page_and_plot(page, obj, profile, cal)


def _tool_create_page_and_plot_text(args: dict[str, Any]) -> dict:
    polylines, meta = _render_text_polylines(args)
    profile, cal = _active_profile_and_cal()
    _validate_inside_plot(polylines, cal)
    name = str(args.get("name") or f"MCP text: {meta['text'][:32]}")[:80]
    obj = _text_object(polylines, **meta)
    return _create_page_job_and_plot(name, [obj], profile, cal)


def _tool_add_text_to_page_and_plot(args: dict[str, Any]) -> dict:
    from ..document import get_document_store
    from ..services.errors import ServiceError

    profile, cal = _active_profile_and_cal()
    page_id = _require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    polylines, meta = _render_text_polylines(args)
    obj = _text_object(polylines, obj_id="mcp-text-added", **meta)
    return _update_page_and_plot(page, obj, profile, cal)


def _tool_create_page_and_plot_gallery_item(args: dict[str, Any]) -> dict:
    polylines, meta = _placed_gallery_polylines(args)
    profile, cal = _active_profile_and_cal()
    _validate_inside_plot(polylines, cal)
    name = str(args.get("name") or f"MCP gallery {meta['item_id']}")[:80]
    obj = _gallery_object(polylines, **meta)
    return _create_page_job_and_plot(name, [obj], profile, cal)


def _tool_add_gallery_item_to_page_and_plot(args: dict[str, Any]) -> dict:
    from ..document import get_document_store
    from ..services.errors import ServiceError

    profile, cal = _active_profile_and_cal()
    page_id = _require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    polylines, meta = _placed_gallery_polylines(args)
    obj = _gallery_object(polylines, obj_id="mcp-gallery-added", **meta)
    return _update_page_and_plot(page, obj, profile, cal)


TOOL_HANDLERS: dict[str, ToolHandler] = {
    "get_printer_status": _tool_get_printer_status,
    "get_printer_position": _tool_get_printer_position,
    "get_mcp_overview": _tool_get_mcp_overview,
    "get_mcp_tutorial": _tool_get_mcp_tutorial,
    "printer_home": _tool_printer_home,
    "printer_move_to": _tool_printer_move_to,
    "printer_pen": _tool_printer_pen,
    "printer_job_command": _tool_printer_job_command,
    "get_active_profile": _tool_get_active_profile,
    "list_profiles": _tool_list_profiles,
    "list_pages": _tool_list_pages,
    "list_mcp_pages": _tool_list_mcp_pages,
    "get_page": _tool_get_page,
    "delete_mcp_page": _tool_delete_mcp_page,
    "get_page_svg": _tool_get_page_svg,
    "list_fonts": _tool_list_fonts,
    "list_gallery": _tool_list_gallery,
    "get_gallery_item": _tool_get_gallery_item,
    "get_gallery_svg": _tool_get_gallery_svg,
    "list_jobs": _tool_list_jobs,
    "get_job_preview": _tool_get_job_preview,
    "plot_page": _tool_plot_page,
    "create_page_and_plot_polylines": _tool_create_page_and_plot_polylines,
    "add_polylines_to_page_and_plot": _tool_add_polylines_to_page_and_plot,
    "create_page_and_plot_drawing": _tool_create_page_and_plot_drawing,
    "add_drawing_to_page_and_plot": _tool_add_drawing_to_page_and_plot,
    "create_page_and_plot_text": _tool_create_page_and_plot_text,
    "add_text_to_page_and_plot": _tool_add_text_to_page_and_plot,
    "create_page_and_plot_gallery_item": _tool_create_page_and_plot_gallery_item,
    "add_gallery_item_to_page_and_plot": _tool_add_gallery_item_to_page_and_plot,
}


# Tools that mutate designer pages; a successful call should refresh the open
# canvas live, not just the page list.
MUTATING_TOOLS = frozenset(
    {
        "delete_mcp_page",
        "create_page_and_plot_polylines",
        "add_polylines_to_page_and_plot",
        "create_page_and_plot_drawing",
        "add_drawing_to_page_and_plot",
        "create_page_and_plot_text",
        "add_text_to_page_and_plot",
        "create_page_and_plot_gallery_item",
        "add_gallery_item_to_page_and_plot",
    }
)


def _tools_call(params: Any) -> dict:
    if not isinstance(params, dict):
        raise ValueError("tools/call params must be an object")
    name = params.get("name")
    if not isinstance(name, str) or name not in TOOL_HANDLERS:
        raise ValueError(f"unknown tool: {name}")
    args = params.get("arguments") or {}
    if not isinstance(args, dict):
        raise ValueError("tool arguments must be an object")
    try:
        content = _json_content(TOOL_HANDLERS[name](args))
    except ToolPayloadError as exc:
        content = _json_content(exc.payload, is_error=True)
    except Exception as exc:
        content = _json_content({"error": str(exc)}, is_error=True)
    # Let the UI surface which MCP tool ran (and whether it succeeded) live.
    # `changed` tells the open designer to also refresh the active page canvas,
    # not just the page list, so an agent's drawing appears immediately.
    ok = not content.get("isError", False)
    hub.publish("mcp", tool=name, ok=ok, changed=ok and name in MUTATING_TOOLS)
    return content


def _handle_message(message: dict) -> dict | None:
    request_id = message.get("id")
    method = message.get("method")

    if not isinstance(method, str):
        return _error(request_id, -32600, "Invalid Request")

    if request_id is None:
        # JSON-RPC notification: acknowledge by returning no response body.
        return None
    if method == "initialize":
        return _result(request_id, _initialize_result())
    if method == "tools/list":
        return _result(request_id, _tools_list_result())
    if method == "tools/call":
        try:
            return _result(request_id, _tools_call(message.get("params")))
        except ValueError as exc:
            return _error(request_id, -32602, str(exc))
    return _error(request_id, -32601, f"Method not found: {method}")


@router.post("/mcp")
async def mcp_rpc(request: Request, authorization: str | None = Header(default=None)) -> Response:
    _require_mcp_enabled(authorization)
    payload = await request.json()

    if isinstance(payload, list):
        responses = []
        for item in payload:
            if not isinstance(item, dict):
                responses.append(_error(None, -32600, "Invalid Request"))
                continue
            response = _handle_message(item)
            if response is not None:
                responses.append(response)
        if not responses:
            return Response(status_code=204)
        return JSONResponse(responses)

    if not isinstance(payload, dict):
        return JSONResponse(_error(None, -32600, "Invalid Request"), status_code=400)
    response = _handle_message(payload)
    if response is None:
        return Response(status_code=204)
    return JSONResponse(response)


@router.get("/mcp")
def mcp_get(authorization: str | None = Header(default=None)) -> dict:
    _require_mcp_enabled(authorization)
    return {"ok": True, "transport": "json-rpc", "tools": len(TOOLS)}
