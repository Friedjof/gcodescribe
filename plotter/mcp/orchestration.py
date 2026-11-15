"""Page/plot orchestration shared by the MCP tool handlers: build page
objects, validate bounds against the active profile, save the job and stream it
to the printer — rolling everything back if any step fails.

Service imports stay inside the functions: tests monkeypatch
``plotter.services.PrinterController``, which only works with late binding.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from plotter.mcp.args import ToolPayloadError, float_arg, int_arg, require_arg
from plotter.mcp.shapes import bounds, coerce_polylines


def profile_bounds_error(cal, bounds: list[float]) -> dict:
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


def validate_inside_plot(polylines: list[list[list[float]]], cal) -> None:
    b = bounds(polylines)
    eps = 0.001
    if b[0] < -eps or b[1] < -eps or b[2] > cal.plot_width + eps or b[3] > cal.plot_height + eps:
        raise ToolPayloadError(profile_bounds_error(cal, b))


def identity_transform() -> dict:
    return {"x": 0, "y": 0, "rotation": 0, "scale": 1}


def next_z(page: dict) -> int:
    values = [float(obj.get("zOrder", i)) for i, obj in enumerate(page.get("objects") or [])]
    return int(max(values, default=-1) + 1)


def line_object(polylines: list[list[list[float]]], *, obj_id: str = "mcp-lines") -> dict:
    return {
        "id": obj_id,
        "type": "line",
        "transform": identity_transform(),
        "cachedPolylines": polylines,
        "data": {"source": "mcp"},
    }


def text_object(
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
        "transform": identity_transform(),
        "cachedPolylines": polylines,
        "data": {
            "source": "mcp",
            "text": text,
            "font": font,
            "size": size,
            "seed": seed,
        },
    }


def gallery_object(
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
        "transform": identity_transform(),
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


def require_printer_ready() -> dict:
    from ..services import PrinterController
    from ..services.errors import ServiceError

    ctrl = PrinterController()
    status = ctrl.status()
    if not status.get("online"):
        raise ServiceError("Printer is not online; nothing was saved or plotted.")
    return {"controller": ctrl, "status": status}


def _validated_project_job_calibration(path: Path):
    from plotter.core.jobmeta import read_job_meta_checked
    from plotter.gcode.pressure import job_uses_pressure
    from plotter.gcode.safety import GcodeSafetyChecker
    from plotter.services.project_render import ProjectJobError, project_job_calibration

    meta, issue = read_job_meta_checked(path)
    if issue or meta is None:
        raise ProjectJobError(issue or "Dem Projekt-Job fehlen die Kalibrierungsmetadaten.")
    cal = project_job_calibration(meta)
    GcodeSafetyChecker(cal, allow_pressure=job_uses_pressure(meta)).check(
        path.read_text(), name=path.name,
    )
    return cal


def plot_existing_page(page: dict) -> dict:
    from plotter.gcode.scene import save_scene_job
    from plotter.services.profiles import profile_meta
    from plotter.services.project_render import page_project_profile

    profile, cal = page_project_profile(page)
    page_polylines_checked(page, cal)
    ready = require_printer_ready()
    ctrl = ready["controller"]
    path = save_scene_job(page, cal, profile=profile_meta(profile))
    try:
        cal = _validated_project_job_calibration(path)
        ctrl.home(cal=cal)
        upload = ctrl.client.upload(path, start=True)
    except Exception:
        from plotter.core.jobmeta import delete_job_meta

        path.unlink(missing_ok=True)
        delete_job_meta(path)
        raise
    return {
        "ok": True,
        "page": {"id": page.get("id"), "name": page.get("name")},
        "job": {"filename": path.name, "upload": upload},
        "printer": ready["status"],
    }


def create_page_job_and_plot(name: str, objects: list[dict]) -> dict:
    from plotter.core.document import get_document_store
    from plotter.core.jobmeta import delete_job_meta
    from plotter.gcode.scene import save_scene_job
    from plotter.services.project_render import page_project_profile

    from ..services.profiles import profile_meta

    ready = require_printer_ready()
    ctrl = ready["controller"]
    store = get_document_store()
    page = store.create_page(
        name,
        mcp={"created": True, "createdAt": time.time(), "tool": "mcp"},
    )
    path: Path | None = None
    try:
        page = store.save_page(page["id"], {"objects": objects})
        profile, cal = page_project_profile(page)
        page_polylines_checked(page, cal)
        path = save_scene_job(page, cal, profile=profile_meta(profile))
        cal = _validated_project_job_calibration(path)
        ctrl.home(cal=cal)
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


def update_page_and_plot(page: dict, obj: dict) -> dict:
    from plotter.core.document import get_document_store
    from plotter.services.project_render import page_project_profile

    store = get_document_store()
    original_objects = page.get("objects") or []
    obj = {**obj, "zOrder": next_z(page)}
    updated = {**page, "objects": [*original_objects, obj]}
    _, cal = page_project_profile(page)
    page_polylines_checked(updated, cal)
    saved = store.save_page(page["id"], {"objects": updated["objects"]})
    try:
        result = plot_existing_page(saved)
    except Exception:
        store.save_page(page["id"], {"objects": original_objects})
        raise
    result["page"] = saved
    return result


def active_profile_and_cal() -> tuple[dict, Any]:
    from plotter.core.calibration import Calibration
    from plotter.core.document import get_document_store

    from ..services.profiles import ProfileService

    project = get_document_store().list_pages()["project"]
    profile = ProfileService().get(project["profileId"])
    return profile, Calibration.from_dict(profile["calibration"])


def render_text_polylines(args: dict[str, Any]) -> tuple[list[list[list[float]]], dict]:
    from plotter.text import text_polylines

    from ..services.stroke_fonts import StrokeFontService

    text = require_arg(args, "text")
    font = require_arg(args, "font")
    x = float_arg(args, "x")
    y = float_arg(args, "y")
    size = float_arg(args, "size")
    if size <= 0:
        raise ValueError("size must be greater than 0")
    seed = int_arg(args, "seed", 0, lo=0, hi=2_147_483_647)
    connect_spaces = bool(args.get("connect_spaces", False))

    if font.startswith("stroke-"):
        rendered = StrokeFontService().render(font, text, size, seed=seed)
        local = rendered.polylines
    else:
        local = text_polylines(text, font=font, size=size, connect_spaces=connect_spaces)
    polylines = coerce_polylines([[[px + x, py + y] for px, py in line] for line in local])
    meta = {"text": text, "font": font, "size": size, "seed": seed}
    return polylines, meta


def placed_gallery_polylines(args: dict[str, Any]) -> tuple[list[list[list[float]]], dict]:
    from ..services.gallery import GalleryService

    item_id = require_arg(args, "item_id")
    page = int_arg(args, "page", 1, lo=1, hi=999)
    x = float_arg(args, "x")
    y = float_arg(args, "y")
    scale = float_arg(args, "scale", 1.0)
    if scale <= 0:
        raise ValueError("scale must be greater than 0")
    preview = GalleryService().preview(item_id, page=page, max_points=40000)
    source_polylines = coerce_polylines(preview.get("polylines") or [])
    polylines = [
        [[round(px * scale + x, 3), round(py * scale + y, 3)] for px, py in line]
        for line in source_polylines
    ]
    return polylines, {"item_id": item_id, "page": page, "x": x, "y": y, "scale": scale}


def page_polylines_checked(page: dict, cal) -> list[list[list[float]]]:
    from plotter.gcode.scene import page_polylines

    polylines = page_polylines(page)
    if not polylines:
        raise ValueError("page contains no plottable lines")
    validate_inside_plot(polylines, cal)
    return polylines
