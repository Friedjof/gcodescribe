"""Rasterize SVG ink for centerline tracing with the system librsvg renderer."""

from __future__ import annotations

import ctypes as c
from ctypes.util import find_library
from pathlib import Path

from plotter.artwork.drawing import svg_raster_source
from plotter.artwork.pipeline import PlotterError


class _Dimensions(c.Structure):
    _fields_ = [
        ("width", c.c_int), ("height", c.c_int),
        ("em", c.c_double), ("ex", c.c_double),
    ]


def _libraries():
    names = (find_library("rsvg-2"), find_library("cairo"), find_library("gobject-2.0"))
    if not all(names):
        raise PlotterError("SVG-Handschrift benötigt die Systembibliothek librsvg.")
    try:
        rsvg, cairo, gobject = (c.CDLL(name) for name in names)
    except OSError as exc:
        raise PlotterError("SVG-Handschrift benötigt die Systembibliothek librsvg.") from exc

    rsvg.rsvg_handle_new_from_data.argtypes = [c.c_char_p, c.c_size_t, c.c_void_p]
    rsvg.rsvg_handle_new_from_data.restype = c.c_void_p
    rsvg.rsvg_handle_get_dimensions.argtypes = [c.c_void_p, c.POINTER(_Dimensions)]
    rsvg.rsvg_handle_render_cairo.argtypes = [c.c_void_p, c.c_void_p]
    rsvg.rsvg_handle_render_cairo.restype = c.c_int
    cairo.cairo_image_surface_create.argtypes = [c.c_int, c.c_int, c.c_int]
    cairo.cairo_image_surface_create.restype = c.c_void_p
    cairo.cairo_create.argtypes = [c.c_void_p]
    cairo.cairo_create.restype = c.c_void_p
    cairo.cairo_set_source_rgb.argtypes = [c.c_void_p, c.c_double, c.c_double, c.c_double]
    cairo.cairo_paint.argtypes = [c.c_void_p]
    cairo.cairo_scale.argtypes = [c.c_void_p, c.c_double, c.c_double]
    cairo.cairo_surface_write_to_png.argtypes = [c.c_void_p, c.c_char_p]
    cairo.cairo_surface_write_to_png.restype = c.c_int
    cairo.cairo_destroy.argtypes = [c.c_void_p]
    cairo.cairo_surface_destroy.argtypes = [c.c_void_p]
    gobject.g_object_unref.argtypes = [c.c_void_p]
    return rsvg, cairo, gobject


def rasterize_svg_ink(source: Path, target: Path, width_mm: float, height_mm: float) -> float:
    """Write an opaque white PNG at up to 300 dpi; return its effective dpi."""
    if width_mm <= 0 or height_mm <= 0:
        raise PlotterError("Das SVG hat keine gültige Seitengröße.")
    rsvg, cairo, gobject = _libraries()
    data = svg_raster_source(source)
    handle = rsvg.rsvg_handle_new_from_data(data, len(data), None)
    if not handle:
        raise PlotterError("Das SVG konnte nicht für den Handschriftmodus gerendert werden.")
    try:
        dimensions = _Dimensions()
        rsvg.rsvg_handle_get_dimensions(handle, c.byref(dimensions))
        if dimensions.width <= 0 or dimensions.height <= 0:
            raise PlotterError("Das SVG hat keine gültige Seitengröße.")
        scale = min(300.0 / 25.4, 2200.0 / max(width_mm, height_mm))
        width_px = max(1, round(width_mm * scale))
        height_px = max(1, round(height_mm * scale))
        surface = cairo.cairo_image_surface_create(0, width_px, height_px)
        if not surface:
            raise PlotterError("Für das SVG konnte kein Bildspeicher angelegt werden.")
        try:
            context = cairo.cairo_create(surface)
            if not context:
                raise PlotterError("Das SVG konnte nicht gerendert werden.")
            try:
                cairo.cairo_set_source_rgb(context, 1, 1, 1)
                cairo.cairo_paint(context)
                cairo.cairo_scale(
                    context, width_px / dimensions.width, height_px / dimensions.height
                )
                if not rsvg.rsvg_handle_render_cairo(handle, context):
                    raise PlotterError("Das SVG konnte nicht gerendert werden.")
                if cairo.cairo_surface_write_to_png(surface, str(target).encode()) != 0:
                    raise PlotterError("Das SVG-Bild konnte nicht gespeichert werden.")
            finally:
                cairo.cairo_destroy(context)
        finally:
            cairo.cairo_surface_destroy(surface)
    finally:
        gobject.g_object_unref(handle)
    return width_px / width_mm * 25.4
