"""MCP tools for designer pages: listing, inspection, deletion and plotting.

The eight create/add-and-plot tool variants share two generic flows
parametrized by an object producer (polylines, drawing elements, text or a
placed gallery item).
"""

from __future__ import annotations

from typing import Any

from plotter.mcp.args import ToolPayloadError, require_arg
from plotter.mcp.orchestration import (
    active_profile_and_cal,
    create_page_job_and_plot,
    gallery_object,
    line_object,
    placed_gallery_polylines,
    plot_existing_page,
    render_text_polylines,
    text_object,
    update_page_and_plot,
    validate_inside_plot,
)
from plotter.mcp.shapes import coerce_polylines, drawing_polylines, polylines_svg


def tool_list_pages(_: dict[str, Any]) -> dict:
    from plotter.core.document import get_document_store

    return get_document_store().list_pages()


def tool_list_mcp_pages(_: dict[str, Any]) -> dict:
    from plotter.core.document import get_document_store

    index = get_document_store().list_pages()
    return {
        "activeId": index.get("activeId"),
        "order": [page for page in index.get("order", []) if page.get("mcpCreated")],
    }


def tool_get_page(args: dict[str, Any]) -> dict:
    from plotter.core.document import get_document_store
    from plotter.services.errors import ServiceError

    page_id = require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    return page


def tool_delete_mcp_page(args: dict[str, Any]) -> dict:
    from plotter.core.document import get_document_store
    from plotter.services.errors import ServiceError

    page_id = require_arg(args, "page_id")
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


def tool_get_page_svg(args: dict[str, Any]) -> dict:
    from plotter.core.document import get_document_store
    from plotter.gcode.scene import page_polylines
    from plotter.services.errors import ServiceError
    from plotter.services.project_render import page_project_profile

    page_id = require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    _, cal = page_project_profile(page)
    polylines = page_polylines(page)
    return {
        "page_id": page_id,
        "name": page.get("name"),
        "width": cal.plot_width,
        "height": cal.plot_height,
        "polylines": polylines,
        "svg": polylines_svg(
            polylines,
            width=cal.plot_width,
            height=cal.plot_height,
            title=str(page.get("name") or page_id),
        ),
    }


def tool_plot_page(args: dict[str, Any]) -> dict:
    from plotter.core.document import get_document_store
    from plotter.services.errors import ServiceError

    page_id = require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    return plot_existing_page(page)


# ── create/add-and-plot family ───────────────────────────────────────────────
# Each spec produces (polylines, meta) from the tool arguments and builds the
# page object; the two generic flows below handle validation, page bookkeeping,
# job creation and rollback identically for all four content kinds.


def _produce_polylines(args: dict[str, Any]) -> tuple[list, dict]:
    return coerce_polylines(args.get("polylines")), {}


def _produce_drawing(args: dict[str, Any]) -> tuple[list, dict]:
    return drawing_polylines(args.get("elements")), {}


_SPECS: dict[str, dict[str, Any]] = {
    "polylines": {
        "produce": _produce_polylines,
        "make_obj": lambda polylines, meta, obj_id: line_object(polylines, obj_id=obj_id)
        if obj_id
        else line_object(polylines),
        "added_id": "mcp-lines-added",
        "default_name": lambda args, meta: "MCP drawing",
    },
    "drawing": {
        "produce": _produce_drawing,
        "make_obj": lambda polylines, meta, obj_id: line_object(polylines, obj_id=obj_id)
        if obj_id
        else line_object(polylines),
        "added_id": "mcp-drawing-added",
        "default_name": lambda args, meta: "MCP drawing",
    },
    "text": {
        "produce": render_text_polylines,
        "make_obj": lambda polylines, meta, obj_id: text_object(polylines, obj_id=obj_id, **meta)
        if obj_id
        else text_object(polylines, **meta),
        "added_id": "mcp-text-added",
        "default_name": lambda args, meta: f"MCP text: {meta['text'][:32]}",
    },
    "gallery": {
        "produce": placed_gallery_polylines,
        "make_obj": lambda polylines, meta, obj_id: gallery_object(polylines, obj_id=obj_id, **meta)
        if obj_id
        else gallery_object(polylines, **meta),
        "added_id": "mcp-gallery-added",
        "default_name": lambda args, meta: f"MCP gallery {meta['item_id']}",
    },
}


def _create_page_and_plot(kind: str, args: dict[str, Any]) -> dict:
    spec = _SPECS[kind]
    _, cal = active_profile_and_cal()
    polylines, meta = spec["produce"](args)
    validate_inside_plot(polylines, cal)
    name = str(args.get("name") or spec["default_name"](args, meta))[:80]
    obj = spec["make_obj"](polylines, meta, None)
    return create_page_job_and_plot(name, [obj])


def _add_to_page_and_plot(kind: str, args: dict[str, Any]) -> dict:
    from plotter.core.document import get_document_store
    from plotter.services.errors import ServiceError

    spec = _SPECS[kind]
    page_id = require_arg(args, "page_id")
    page = get_document_store().get_page(page_id)
    if not page:
        raise ServiceError(f"Seite nicht gefunden: {page_id}")
    polylines, meta = spec["produce"](args)
    obj = spec["make_obj"](polylines, meta, spec["added_id"])
    return update_page_and_plot(page, obj)


def tool_create_page_and_plot_polylines(args: dict[str, Any]) -> dict:
    return _create_page_and_plot("polylines", args)


def tool_add_polylines_to_page_and_plot(args: dict[str, Any]) -> dict:
    return _add_to_page_and_plot("polylines", args)


def tool_create_page_and_plot_drawing(args: dict[str, Any]) -> dict:
    return _create_page_and_plot("drawing", args)


def tool_add_drawing_to_page_and_plot(args: dict[str, Any]) -> dict:
    return _add_to_page_and_plot("drawing", args)


def tool_create_page_and_plot_text(args: dict[str, Any]) -> dict:
    return _create_page_and_plot("text", args)


def tool_add_text_to_page_and_plot(args: dict[str, Any]) -> dict:
    return _add_to_page_and_plot("text", args)


def tool_create_page_and_plot_gallery_item(args: dict[str, Any]) -> dict:
    return _create_page_and_plot("gallery", args)


def tool_add_gallery_item_to_page_and_plot(args: dict[str, Any]) -> dict:
    return _add_to_page_and_plot("gallery", args)
