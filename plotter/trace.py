from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .pipeline import PlotterError, ensure_command, run_command

TRACE_DPI = 200.0  # rasterisation resolution for PDFs — keeps text legible
IMAGE_DPI = 96.0  # assumed resolution of plain raster images


def rasterize_pdf_page(source: Path, workdir: Path, page: int, dpi: float = TRACE_DPI) -> Path:
    """Render one PDF page to a grayscale PNG via pdftoppm (poppler)."""
    pdftoppm = ensure_command("pdftoppm")
    prefix = workdir / f"page-{page:04d}"
    run_command(
        [
            pdftoppm, "-png", "-gray",
            "-r", f"{dpi:.0f}",
            "-f", str(page), "-l", str(page),
            "-singlefile",
            str(source), str(prefix),
        ]
    )
    out = prefix.with_suffix(".png")
    if not out.exists():
        raise PlotterError(f"pdftoppm did not produce PNG output for page {page}")
    return out


def _thresholds(gray: np.ndarray, detail: int) -> list[float]:
    """Gray levels at which area borders are extracted (Otsu + extras)."""
    otsu, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if detail <= 1:
        return [otsu]
    if detail == 2:
        return sorted({otsu, min(otsu + 60.0, 230.0)})
    return sorted({max(otsu - 50.0, 25.0), otsu, min(otsu + 60.0, 230.0)})


def trace_image_to_svg(
    image_path: Path,
    svg_path: Path,
    *,
    dpi: float = IMAGE_DPI,
    detail: int = 1,
) -> tuple[float, float]:
    """Trace area borders of a raster image into a simple SVG.

    Grayscale -> threshold level(s) -> contours -> simplified closed paths.
    Coordinates are written in mm so the page size is preserved downstream.
    Returns (width_mm, height_mm).
    """
    img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise PlotterError(f"could not read image: {image_path}")
    h_px, w_px = img.shape
    px2mm = 25.4 / dpi
    blur = cv2.GaussianBlur(img, (3, 3), 0)

    min_area_px = (0.5 / px2mm) ** 2  # drop specks smaller than ~0.5 mm²
    eps_px = max(0.08 / px2mm, 1.0)  # ~0.08 mm simplification keeps text legible

    paths: list[np.ndarray] = []
    seen: set[tuple] = set()
    for t in _thresholds(blur, detail):
        _, bw = cv2.threshold(blur, t, 255, cv2.THRESH_BINARY_INV)
        contours, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_TC89_KCOS)
        for contour in contours:
            if cv2.contourArea(contour) < min_area_px:
                continue
            approx = cv2.approxPolyDP(contour, eps_px, True).reshape(-1, 2)
            if len(approx) < 3:
                continue
            pts = approx.astype(np.float64) * px2mm
            # Dedupe near-identical contours found at multiple thresholds
            # (sharp edges like text appear at every level).
            key = (len(pts), tuple(np.round(pts[:: max(len(pts) // 8, 1)].ravel() / 0.3)))
            if key in seen:
                continue
            seen.add(key)
            paths.append(pts)

    if not paths:
        raise PlotterError(
            "Keine Konturen gefunden — das Bild ist leer oder zu kontrastarm."
        )

    w_mm, h_mm = w_px * px2mm, h_px * px2mm
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w_mm:.3f}mm" '
        f'height="{h_mm:.3f}mm" viewBox="0 0 {w_mm:.3f} {h_mm:.3f}">',
    ]
    for pts in paths:
        d = "M " + " L ".join(f"{x:.3f},{y:.3f}" for x, y in pts) + " Z"
        parts.append(f'<path d="{d}" fill="none" stroke="black" stroke-width="0.2"/>')
    parts.append("</svg>")
    svg_path.write_text("\n".join(parts))
    return w_mm, h_mm


def _svg_polyline(points: list[tuple[float, float]]) -> str:
    if len(points) < 2:
        return ""
    d = "M " + " L ".join(f"{x:.3f},{y:.3f}" for x, y in points)
    return f'<path d="{d}" fill="none" stroke="black" stroke-width="0.2"/>'


def image_lines_to_svg(
    image_path: Path,
    svg_path: Path,
    *,
    dpi: float = IMAGE_DPI,
    detail: int = 1,
    mode: str = "lines",
) -> tuple[float, float]:
    """Convert raster tones into plotter-friendly line/dot SVGs.

    Modes are intentionally simple and deterministic:
    - lines: horizontal tone lines, darker areas produce longer segments
    - hatch: diagonal hatching with density from tone
    - dots: small crosses, darker areas produce more marks
    """
    img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise PlotterError(f"could not read image: {image_path}")
    h_px, w_px = img.shape
    px2mm = 25.4 / dpi
    w_mm, h_mm = w_px * px2mm, h_px * px2mm
    detail = max(1, min(detail, 3))
    step_mm = {1: 3.0, 2: 2.0, 3: 1.25}[detail]
    cell_px = max(2, int(step_mm / px2mm))
    blur = cv2.GaussianBlur(img, (5, 5), 0)
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w_mm:.3f}mm" '
        f'height="{h_mm:.3f}mm" viewBox="0 0 {w_mm:.3f} {h_mm:.3f}">',
    ]

    for y in range(cell_px // 2, h_px, cell_px):
        for x in range(cell_px // 2, w_px, cell_px):
            patch = blur[max(0, y - cell_px // 2): min(h_px, y + cell_px // 2),
                         max(0, x - cell_px // 2): min(w_px, x + cell_px // 2)]
            darkness = 1.0 - float(patch.mean()) / 255.0
            if darkness < 0.18:
                continue
            cx, cy = x * px2mm, y * px2mm
            length = step_mm * (0.25 + darkness * 0.9)
            if mode == "dots":
                r = min(step_mm * 0.28, length * 0.25)
                parts.append(_svg_polyline([(cx - r, cy), (cx + r, cy)]))
                if darkness > 0.45:
                    parts.append(_svg_polyline([(cx, cy - r), (cx, cy + r)]))
            elif mode == "hatch":
                h = length / 2
                parts.append(_svg_polyline([(cx - h, cy + h), (cx + h, cy - h)]))
                if darkness > 0.68:
                    parts.append(_svg_polyline([(cx - h, cy - h), (cx + h, cy + h)]))
            else:
                parts.append(_svg_polyline([(cx - length / 2, cy), (cx + length / 2, cy)]))

    if len(parts) == 2:
        raise PlotterError("Keine Linien gefunden — das Bild ist leer oder zu hell.")
    parts.append("</svg>")
    svg_path.write_text("\n".join(p for p in parts if p))
    return w_mm, h_mm
