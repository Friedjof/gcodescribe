from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from plotter.artwork.drawing import Drawing
from plotter.artwork.pipeline import PlotterError, ensure_command, run_command
from plotter.geometry.smoothing import chaikin

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

# Perpendicular-deviation tolerance (px, same downscaled "work" pixel space as
# the RDP epsilon above) for classifying a whole stroke as "meant to be
# straight". Deliberately much larger than the RDP epsilon: photographed or
# AI-rendered "sketch style" ink has a few px of real per-pixel wobble even
# where a human drew (or intended) a straight line, and RDP+Chaikin faithfully
# preserve that wobble instead of flattening it. This is a binary
# straight/not-straight call, not a curve-fidelity knob — genuine corners and
# curves deviate from a stroke's end-to-end chord by tens to hundreds of px,
# far past any of these tolerances, so they're never mistaken for noise.
_STRAIGHTEN_TOL_PX = {1: 10.0, 2: 7.0, 3: 5.0}

# Stroke consolidation: overdrawn/retraced pencil marks come out of
# skeletonisation as separate strokes running right alongside each other,
# not one. Two strokes are treated as the same intended line — and only the
# longer one kept — when they run near-parallel, stay within a small
# distance of each other, and the shorter one's span is substantially
# covered by the longer one's (mm, real-world units — this runs on the
# already coord2mm-scaled output).
_CONSOLIDATE_ANGLE_TOL_DEG = 20.0
_CONSOLIDATE_MAX_PERP_MM = 2.0
_CONSOLIDATE_MIN_OVERLAP_FRAC = 0.7

_NEIGHBOURS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))

# Pencil-pressure handling: pixel binarisation throws away how dark each
# stroke was, so a firm line and a faint sketch guide come out identical.
# We classify strokes by the mean grayscale under their own skeleton pixels
# and, only when the image actually has that contrast, drop the faintest
# strokes and double-draw the darkest ones for emphasis. Gated on spread so
# uniform ink (a plain handwriting scan) is left exactly as before.
_MIN_STROKES_FOR_SHADING = 6
_MIN_DARKNESS_SPREAD = 10.0  # stdev of per-stroke mean grayscale, 0-255 scale
_FAINT_SHARE = 0.15  # lightest fraction of strokes to drop
_BOLD_SHARE = 0.15  # darkest fraction of strokes to draw twice


def _direction(a: tuple[int, int], b: tuple[int, int]) -> np.ndarray:
    return np.array([b[0] - a[0], b[1] - a[1]], dtype=float)


def _choose_straightest(
    prev: tuple[int, int],
    cur: tuple[int, int],
    candidates: list[tuple[int, int]],
) -> tuple[int, int]:
    """Pick the candidate continuing straightest ahead through a junction."""
    incoming = _direction(prev, cur)
    incoming /= np.linalg.norm(incoming)
    best = candidates[0]
    best_score = -float("inf")
    for candidate in candidates:
        outgoing = _direction(cur, candidate)
        outgoing /= np.linalg.norm(outgoing)
        score = float(np.dot(incoming, outgoing))
        if score > best_score:
            best_score = score
            best = candidate
    return best


def _skeleton_to_polylines(sk: np.ndarray) -> list[list[tuple[int, int]]]:
    """Walk a skeleton bitmap into polylines of (x, y) pixels.

    Pixels are graph nodes. A walk continues through a junction (degree >=3)
    by picking the straightest unused edge, so a stroke crossing another one
    keeps going instead of getting chopped up at every intersection. Walks
    start at true endpoints (degree 1) first, then at any junction edges
    left unused, then any remaining pure loops.
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
        while True:
            candidates = [q for q in neighbours(cur) if frozenset((cur, q)) not in used]
            if not candidates:
                break
            nxt = (
                candidates[0]
                if len(candidates) == 1
                else _choose_straightest(prev, cur, candidates)
            )
            used.add(frozenset((cur, nxt)))
            line.append(nxt)
            prev, cur = cur, nxt
        return line

    polylines: list[list[tuple[int, int]]] = []
    for node in (p for p in pts if deg[p] == 1):
        for nb in neighbours(node):
            if frozenset((node, nb)) not in used:
                polylines.append(walk(node, nb))
    for node in (p for p in pts if deg[p] >= 3):
        for nb in neighbours(node):
            if frozenset((node, nb)) not in used:
                polylines.append(walk(node, nb))
    for p in pts:  # leftover closed loops (every pixel degree 2)
        for nb in neighbours(p):
            if frozenset((p, nb)) not in used:
                polylines.append(walk(p, nb))
    # Coordinates were padded by 1px; shift back to image space.
    return [[(x - 1, y - 1) for x, y in line] for line in polylines]


def _straighten_if_line(points: np.ndarray, tol_px: float) -> np.ndarray | None:
    """If a raw stroke is essentially one straight line, return its exact
    2-point replacement; otherwise None so the normal RDP/Chaikin path runs.
    """
    if len(points) < 8:
        return None
    a, b = points[0], points[-1]
    d = b - a
    length = np.linalg.norm(d)
    if length < 1e-6:
        return None
    normal = np.array([-d[1], d[0]]) / length
    offsets = (points - a) @ normal
    max_dev = np.abs(offsets).max()
    if max_dev > tol_px:
        return None
    if max_dev < 0.5:
        return np.stack([a, b])  # already essentially exact
    # Noise wobbles around the chord; a real (if subtle) bend drifts to one
    # side. Require it to cross the chord more than once before snapping.
    signs = np.sign(offsets)
    signs = signs[signs != 0]
    if len(signs) < 4 or np.count_nonzero(np.diff(signs) != 0) < 2:
        return None
    return np.stack([a, b])


def _stroke_arclen(pts: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())


def _point_to_polyline_dist(points: np.ndarray, poly: np.ndarray) -> np.ndarray:
    """Min distance from each row in ``points`` to the polyline ``poly``.

    Distance to the nearest *segment* (clipped projection), not the nearest
    vertex — a straightened/simplified stroke can be just its two endpoints,
    and a vertex-only distance would wrongly see its own midpoint as far away.
    """
    seg_a, seg_b = poly[:-1], poly[1:]
    d = seg_b - seg_a
    d_len2 = np.einsum("ij,ij->i", d, d)
    d_len2[d_len2 == 0] = 1e-12
    diffs = points[:, None, :] - seg_a[None, :, :]
    t = np.einsum("nmi,mi->nm", diffs, d) / d_len2[None, :]
    t = np.clip(t, 0.0, 1.0)
    proj = seg_a[None, :, :] + t[:, :, None] * d[None, :, :]
    return np.linalg.norm(points[:, None, :] - proj, axis=2).min(axis=1)


def _strokes_are_duplicates(short_pts: np.ndarray, long_pts: np.ndarray) -> bool:
    """True if ``short_pts`` looks like a re-drawn copy of part of ``long_pts``."""

    def axis(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
        d = pts[-1] - pts[0]
        length = np.linalg.norm(d)
        return pts[0], d / length, length

    _, short_dir, _ = axis(short_pts)
    long_origin, long_dir, long_len = axis(long_pts)
    cos_angle = abs(float(np.dot(short_dir, long_dir)))
    angle_deg = np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0)))
    if angle_deg > _CONSOLIDATE_ANGLE_TOL_DEG:
        return False

    # Every point of the shorter stroke must land near the longer one's path
    # — not just near its endpoints, so a sparse (e.g. already-straightened)
    # long stroke still measures correctly against a duplicate's midpoint.
    nearest = _point_to_polyline_dist(short_pts, long_pts)
    if nearest.max() > _CONSOLIDATE_MAX_PERP_MM:
        return False

    proj = (short_pts - long_origin) @ long_dir
    inside = np.clip(proj, 0.0, long_len)
    overlap_frac = float(np.mean(np.abs(inside - proj) < 0.5))
    return overlap_frac >= _CONSOLIDATE_MIN_OVERLAP_FRAC


def _consolidate_strokes(
    strokes: list[np.ndarray], bold_flags: list[bool]
) -> list[tuple[np.ndarray, bool]]:
    """Drop strokes that are near-duplicate overdraws of a longer one.

    Union-Find over stroke pairs that pass ``_strokes_are_duplicates``; each
    resulting group keeps only its longest stroke, so an intended pencil line
    that was drawn (or overdrawn) more than once is only plotted once.
    """
    n = len(strokes)
    if n < 2:
        return list(zip(strokes, bold_flags, strict=True))

    lengths = [_stroke_arclen(s) for s in strokes]
    boxes = [
        (s[:, 0].min(), s[:, 0].max(), s[:, 1].min(), s[:, 1].max()) for s in strokes
    ]
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: int, y: int) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[ry] = rx

    pad = _CONSOLIDATE_MAX_PERP_MM
    for i in range(n):
        ax0, ax1, ay0, ay1 = boxes[i]
        for j in range(i + 1, n):
            bx0, bx1, by0, by1 = boxes[j]
            if ax1 + pad < bx0 or bx1 + pad < ax0 or ay1 + pad < by0 or by1 + pad < ay0:
                continue  # bounding boxes too far apart to possibly be duplicates
            short_i, long_i = (i, j) if lengths[i] <= lengths[j] else (j, i)
            if _strokes_are_duplicates(strokes[short_i], strokes[long_i]):
                union(i, j)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    result: list[tuple[np.ndarray, bool]] = []
    for members in groups.values():
        best = max(members, key=lambda i: lengths[i])
        result.append((strokes[best], any(bold_flags[i] for i in members)))
    return result


def _centerline_paths(
    image_path: Path, dpi: float, detail: int, *, uniform_ink: bool = False
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
    if uniform_ink:
        # Rendered SVGs have a clean white background. Adaptive thresholding
        # turns wide, flat-filled strokes into two edge bands instead of ink.
        _, bw = cv2.threshold(work, 200, 255, cv2.THRESH_BINARY_INV)
    else:
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

    kept: list[np.ndarray] = []
    for line in lines:
        if len(line) < 2:
            continue
        arr = np.asarray(line, dtype=np.float32)
        seg_len = float(np.linalg.norm(np.diff(arr, axis=0), axis=1).sum())
        if seg_len < min_spur_px and len(line) < 6:
            continue  # tiny skeleton hair
        kept.append(arr)

    # Classify by underlying ink darkness (lower gray value = darker), but
    # only when there is real tonal spread to justify it.
    drop = np.zeros(len(kept), dtype=bool)
    bold = np.zeros(len(kept), dtype=bool)
    if len(kept) >= _MIN_STROKES_FOR_SHADING:
        means = np.array(
            [work[arr[:, 1].astype(int), arr[:, 0].astype(int)].mean() for arr in kept]
        )
        if means.std() >= _MIN_DARKNESS_SPREAD:
            order = np.argsort(means)  # ascending: darkest stroke first
            n_bold = max(1, round(len(order) * _BOLD_SHARE))
            n_faint = max(1, round(len(order) * _FAINT_SHARE))
            bold[order[:n_bold]] = True
            drop[order[-n_faint:]] = True

    drafted: list[tuple[np.ndarray, bool]] = []
    for arr, is_drop, is_bold in zip(kept, drop, bold, strict=True):
        if is_drop:
            continue  # faint construction line — leave it off the plot
        straight = _straighten_if_line(arr, _STRAIGHTEN_TOL_PX[detail])
        if straight is not None:
            smoothed = straight.astype(np.float64) * coord2mm
        else:
            approx = cv2.approxPolyDP(arr.reshape(-1, 1, 2), eps_px, False).reshape(-1, 2)
            if len(approx) < 2:
                continue
            smoothed = chaikin(approx.astype(np.float64), smooth_iters) * coord2mm
        drafted.append((smoothed, bool(is_bold)))

    # Consolidate before doubling bold strokes — otherwise the intentional
    # "draw twice" emphasis copy would look like a duplicate overdraw and get
    # merged straight back down to one, undoing the shading feature above.
    paths: list[np.ndarray] = []
    for smoothed, is_bold in _consolidate_strokes(
        [s for s, _ in drafted], [b for _, b in drafted]
    ):
        paths.append(smoothed)
        if is_bold:
            paths.append(smoothed.copy())  # second pass for emphasis

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
    uniform_ink: bool = False,
) -> Drawing:
    """Like :func:`centerline_image_to_svg`, but also returns the Drawing."""
    paths, w_mm, h_mm = _centerline_paths(
        image_path, dpi, detail, uniform_ink=uniform_ink
    )
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
