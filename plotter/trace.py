from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .drawing import Drawing
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
        raise PlotterError(f"pdftoppm hat für Seite {page} keine PNG-Ausgabe erzeugt")
    return out


def _thresholds(gray: np.ndarray, detail: int) -> list[float]:
    """Gray levels at which area borders are extracted (Otsu + extras)."""
    otsu, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if detail <= 1:
        return [otsu]
    if detail == 2:
        return sorted({otsu, min(otsu + 60.0, 230.0)})
    return sorted({max(otsu - 50.0, 25.0), otsu, min(otsu + 60.0, 230.0)})


def _trace_contours(
    image_path: Path, dpi: float, detail: int
) -> tuple[list[np.ndarray], float, float]:
    """Core trace: grayscale -> threshold level(s) -> simplified closed paths.

    Returns ``(paths, width_mm, height_mm)`` where each path is an ``(N, 2)``
    array of mm coordinates (closed contour, last point != first).
    """
    img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise PlotterError(f"Bild konnte nicht gelesen werden: {image_path}")
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
    return paths, w_px * px2mm, h_px * px2mm


def _drawing_from_paths(
    paths: list[np.ndarray], w_mm: float, h_mm: float, *, close: bool
) -> Drawing:
    """Build an in-memory Drawing from trace paths, avoiding an SVG round-trip.

    Coordinates already match ``load_svg_drawing``'s output (both end up in mm),
    so callers get the same geometry without re-parsing the written SVG.
    """
    polylines: list[np.ndarray] = []
    for pts in paths:
        line = pts[:, 0] + 1j * pts[:, 1]
        if close and len(line) > 1 and line[0] != line[-1]:
            line = np.append(line, line[0])  # match the SVG's closing "Z"
        if len(line) > 1:
            polylines.append(line)
    return Drawing(polylines, w_mm, h_mm)


def _write_trace_svg(svg_path: Path, paths: list[np.ndarray], w_mm: float, h_mm: float) -> None:
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
    paths, w_mm, h_mm = _trace_contours(image_path, dpi, detail)
    _write_trace_svg(svg_path, paths, w_mm, h_mm)
    return w_mm, h_mm


def trace_image_to_drawing(
    image_path: Path,
    svg_path: Path,
    *,
    dpi: float = IMAGE_DPI,
    detail: int = 1,
) -> Drawing:
    """Trace an image, write its SVG, and return the Drawing in one pass.

    Same SVG output as :func:`trace_image_to_svg`, but the in-memory contours
    are reused to build the Drawing directly — skipping the costly vpype
    re-parse of what can be a multi-MB SVG for detailed/noisy images.
    """
    paths, w_mm, h_mm = _trace_contours(image_path, dpi, detail)
    _write_trace_svg(svg_path, paths, w_mm, h_mm)
    return _drawing_from_paths(paths, w_mm, h_mm, close=True)


# Centerline ("Handschrift") tracing -----------------------------------------
# Outline tracing draws both edges of every stroke, so handwriting comes out
# doubled. Centerline tracing skeletonises the ink to a 1px medial axis and
# follows it, so the pen retraces the original writing path instead.

# Longest image edge fed to the skeletoniser. Downscaling keeps it fast and,
# more importantly, suppresses the skeleton "hairs" that high-res scans grow.
_CENTERLINE_MAX_EDGE = 2200
# Per detail level: (simplification epsilon px, min spur length px, Chaikin
# smoothing iterations). RDP first removes the pixel-skeleton staircase, then
# Chaikin corner-cutting rounds the result so handwriting flows instead of
# coming out polygonal.
_CENTERLINE_DETAIL = {1: (1.5, 6.0, 1), 2: (1.0, 3.0, 2), 3: (0.6, 2.0, 2)}

_NEIGHBOURS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))


def _chaikin(points: np.ndarray, iterations: int) -> np.ndarray:
    """Chaikin corner-cutting: round a polyline by replacing each segment with
    its 1/4 and 3/4 points. Endpoints stay fixed so open strokes keep their
    start/end. Curves stay within the original hull (no overshoot)."""
    pts = points
    for _ in range(iterations):
        if len(pts) < 3:
            break
        a, b = pts[:-1], pts[1:]
        cut = np.empty((2 * len(a), 2), dtype=pts.dtype)
        cut[0::2] = 0.75 * a + 0.25 * b
        cut[1::2] = 0.25 * a + 0.75 * b
        pts = np.vstack((pts[0], cut, pts[-1]))
    return pts


def _skeleton_to_polylines(sk: np.ndarray) -> list[list[tuple[int, int]]]:
    """Walk a skeleton bitmap into polylines of (x, y) pixels.

    Pixels are graph nodes; degree-2 pixels are interior points of a stroke,
    degree 1 (endpoints) or >=3 (junctions) start/stop chains. Chains between
    nodes are walked first, then any remaining pure loops.
    """
    padded = np.pad(sk.astype(np.uint8), 1)
    ys, xs = np.where(padded > 0)
    deg = {
        (int(x), int(y)): int(
            padded[y - 1, x - 1] + padded[y - 1, x] + padded[y - 1, x + 1]
            + padded[y, x - 1] + padded[y, x + 1]
            + padded[y + 1, x - 1] + padded[y + 1, x] + padded[y + 1, x + 1]
        )
        for x, y in zip(xs, ys, strict=True)
    }
    pts = set(deg)

    def neighbours(p):
        x, y = p
        return [(x + dx, y + dy) for dx, dy in _NEIGHBOURS if (x + dx, y + dy) in pts]

    used: set[frozenset] = set()

    def walk(a, b):
        line = [a, b]
        used.add(frozenset((a, b)))
        prev, cur = a, b
        while deg.get(cur, 0) == 2:
            nxt = [q for q in neighbours(cur) if q != prev]
            if not nxt or frozenset((cur, nxt[0])) in used:
                break
            used.add(frozenset((cur, nxt[0])))
            line.append(nxt[0])
            prev, cur = cur, nxt[0]
        return line

    polylines: list[list[tuple[int, int]]] = []
    for node in (p for p in pts if deg[p] != 2):
        for nb in neighbours(node):
            if frozenset((node, nb)) not in used:
                polylines.append(walk(node, nb))
    for p in pts:  # leftover closed loops (every pixel degree 2)
        for nb in neighbours(p):
            if frozenset((p, nb)) not in used:
                polylines.append(walk(p, nb))
    # Coordinates were padded by 1px; shift back to image space.
    return [[(x - 1, y - 1) for x, y in line] for line in polylines]


def _centerline_paths(
    image_path: Path, dpi: float, detail: int
) -> tuple[list[np.ndarray], float, float]:
    """Skeletonise ink to centreline polylines. Returns (paths_mm, w_mm, h_mm)."""
    from skimage.morphology import skeletonize

    img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise PlotterError(f"Bild konnte nicht gelesen werden: {image_path}")
    h_px, w_px = img.shape
    px2mm = 25.4 / dpi
    detail = max(1, min(detail, 3))
    eps_px, min_spur_px, smooth_iters = _CENTERLINE_DETAIL[detail]

    # Downscale large scans; track the factor so output stays in original mm.
    scale = min(1.0, _CENTERLINE_MAX_EDGE / max(h_px, w_px))
    work = img
    if scale < 1.0:
        work = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    coord2mm = px2mm / scale

    # Adaptive threshold copes with uneven lighting when photographing paper.
    bw = cv2.adaptiveThreshold(
        work, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 15
    )
    # Drop isolated speckles before skeletonising — they become stray dots.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(bw, 8)
    cleaned = np.zeros_like(bw)
    min_area = max(int((min_spur_px) ** 2), 6)
    for i in range(1, count):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            cleaned[labels == i] = 255

    skeleton = skeletonize(cleaned > 0)
    lines = _skeleton_to_polylines(skeleton)

    paths: list[np.ndarray] = []
    for line in lines:
        if len(line) < 2:
            continue
        arr = np.asarray(line, dtype=np.float32)
        seg_len = float(np.linalg.norm(np.diff(arr, axis=0), axis=1).sum())
        if seg_len < min_spur_px and len(line) < 6:
            continue  # tiny skeleton hair
        approx = cv2.approxPolyDP(arr.reshape(-1, 1, 2), eps_px, False).reshape(-1, 2)
        if len(approx) < 2:
            continue
        smoothed = _chaikin(approx.astype(np.float64), smooth_iters)
        paths.append(smoothed * coord2mm)

    if not paths:
        raise PlotterError(
            "Keine Striche gefunden — das Bild ist leer oder zu kontrastarm."
        )
    return paths, w_px * px2mm, h_px * px2mm


def centerline_image_to_svg(
    image_path: Path,
    svg_path: Path,
    *,
    dpi: float = IMAGE_DPI,
    detail: int = 1,
) -> tuple[float, float]:
    """Trace an image's ink centrelines (open strokes) into an SVG."""
    paths, w_mm, h_mm = _centerline_paths(image_path, dpi, detail)
    _write_lines_svg(svg_path, [p.tolist() for p in paths], w_mm, h_mm)
    return w_mm, h_mm


def centerline_image_to_drawing(
    image_path: Path,
    svg_path: Path,
    *,
    dpi: float = IMAGE_DPI,
    detail: int = 1,
) -> Drawing:
    """Like :func:`centerline_image_to_svg`, but also returns the Drawing."""
    paths, w_mm, h_mm = _centerline_paths(image_path, dpi, detail)
    _write_lines_svg(svg_path, [p.tolist() for p in paths], w_mm, h_mm)
    return _drawing_from_paths(paths, w_mm, h_mm, close=False)


def _svg_polyline(points: list[tuple[float, float]]) -> str:
    if len(points) < 2:
        return ""
    d = "M " + " L ".join(f"{x:.3f},{y:.3f}" for x, y in points)
    return f'<path d="{d}" fill="none" stroke="black" stroke-width="0.2"/>'


def _image_line_segments(
    image_path: Path, dpi: float, detail: int, mode: str
) -> tuple[list[list[tuple[float, float]]], float, float]:
    """Core of the line/hatch/dot modes: return the mm segments + page size."""
    img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise PlotterError(f"Bild konnte nicht gelesen werden: {image_path}")
    h_px, w_px = img.shape
    px2mm = 25.4 / dpi
    w_mm, h_mm = w_px * px2mm, h_px * px2mm
    detail = max(1, min(detail, 3))
    step_mm = {1: 3.0, 2: 2.0, 3: 1.25}[detail]
    cell_px = max(2, int(step_mm / px2mm))
    blur = cv2.GaussianBlur(img, (5, 5), 0)
    segments: list[list[tuple[float, float]]] = []

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
                segments.append([(cx - r, cy), (cx + r, cy)])
                if darkness > 0.45:
                    segments.append([(cx, cy - r), (cx, cy + r)])
            elif mode == "hatch":
                h = length / 2
                segments.append([(cx - h, cy + h), (cx + h, cy - h)])
                if darkness > 0.68:
                    segments.append([(cx - h, cy - h), (cx + h, cy + h)])
            else:
                segments.append([(cx - length / 2, cy), (cx + length / 2, cy)])

    if not segments:
        raise PlotterError("Keine Linien gefunden — das Bild ist leer oder zu hell.")
    return segments, w_mm, h_mm


def _write_lines_svg(
    svg_path: Path, segments: list[list[tuple[float, float]]], w_mm: float, h_mm: float
) -> None:
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w_mm:.3f}mm" '
        f'height="{h_mm:.3f}mm" viewBox="0 0 {w_mm:.3f} {h_mm:.3f}">',
    ]
    parts.extend(_svg_polyline(seg) for seg in segments)
    parts.append("</svg>")
    svg_path.write_text("\n".join(p for p in parts if p))


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
    segments, w_mm, h_mm = _image_line_segments(image_path, dpi, detail, mode)
    _write_lines_svg(svg_path, segments, w_mm, h_mm)
    return w_mm, h_mm


def image_lines_to_drawing(
    image_path: Path,
    svg_path: Path,
    *,
    dpi: float = IMAGE_DPI,
    detail: int = 1,
    mode: str = "lines",
) -> Drawing:
    """Like :func:`image_lines_to_svg`, but also returns the Drawing directly."""
    segments, w_mm, h_mm = _image_line_segments(image_path, dpi, detail, mode)
    _write_lines_svg(svg_path, segments, w_mm, h_mm)
    paths = [np.asarray(seg, dtype=np.float64) for seg in segments]
    return _drawing_from_paths(paths, w_mm, h_mm, close=False)
