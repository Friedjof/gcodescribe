"""Single-line (single-stroke) font rendering for the paint/markdown editor.

Unlike normal outline fonts, single-line fonts store each glyph as *open*
strokes — one centreline the pen follows, never a doubled contour. We read the
glyph paths with fontTools and deliberately do **not** close contours, so the
result plots as a single thin line (high plot score).

Fonts are vendored under ``plotter/fonts/`` and loaded by path (no system font
lookup) so rendering is deterministic across machines.
"""
from __future__ import annotations

import math
import random
import re
import zlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from fontTools.pens.recordingPen import DecomposingRecordingPen, RecordingPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont
from skimage.draw import polygon
from skimage.morphology import skeletonize

from .pipeline import PlotterError

Point = tuple[float, float]
Polyline = list[Point]

_FONT_DIR = Path(__file__).parent / "fonts"


@dataclass(frozen=True)
class Humanize:
    """Per-glyph variation that turns a clean print font into hand-printed
    handwriting. All amplitudes are fractions of the em (text size). Applied as
    rigid per-glyph transforms plus tiny vertex noise, so it adds no pen lifts
    and almost no draw length — the plot score stays high."""

    rotate_deg: float = 2.5   # max per-glyph tilt
    scale_var: float = 0.035  # per-glyph size wobble
    baseline: float = 0.05    # vertical bounce
    x_jitter: float = 0.02    # horizontal nudge
    advance: float = 0.03     # uneven letter spacing
    # Per-point waviness. Kept at 0 for clean print handwriting: it inflates
    # draw length (zig-zag between dense curve points) and lowers the score.
    vertex: float = 0.0


# Registry: font key -> file under plotter/fonts/. All are OTF-SVG single-line
# fonts: the true one-stroke geometry lives in their SVG table.
FONT_FILES = {
    "sans": "ReliefSingleLineOTF-SVG-Regular.otf",
    "hand": "ReliefSingleLineOTF-SVG-Regular.otf",
    "script": "MistralSingleLine-Regular.otf",
}

# Fonts that apply hand-printed humanization on top of their base file.
FONT_HUMANIZE = {
    "hand": Humanize(),
}

# Cursive fonts: join consecutive letters of a word into one continuous path so
# each word plots as a single pen-down (huge pen-lift reduction). We chain each
# letter's main stroke through a curved Bézier connector; dots/accents/crossbars
# are collected as separate "marks" plotted after the main paths.
FONT_CONNECT = {"script"}

# Fonts whose true single-line geometry lives in the OpenType SVG table (one open
# <path> per glyph) rather than the CFF/glyf outline. The CFF in these fonts is a
# *doubled* thin outline; the SVG table is the genuine single centreline.
FONT_SVG = {"sans", "hand", "script"}


@dataclass(frozen=True)
class WordJitter:
    """Subtle per-word variation for cursive fonts so a line of handwriting does
    not sit on a ruler-straight baseline with identical words. Applied as one
    rigid transform per word *after* the word's letters are joined, so the
    intra-word connections (and the dots/accents) move together and stay intact.
    Amplitudes are fractions of the em except rotation (degrees)."""

    rotate_deg: float = 1.4
    scale: float = 0.02
    x: float = 0.012
    baseline: float = 0.03


# Cursive fonts get per-word humanization keyed here.
FONT_WORD_JITTER = {"script": WordJitter()}


@dataclass(frozen=True)
class Warp:
    """Smooth position-dependent displacement applied to the whole render so the
    baseline drifts and individual letters don't all sit on the same line. Being
    a pure function of position, coincident points (the cursive joins) move
    together, so no connection is ever broken. Amplitudes are fractions of em."""

    y: float = 0.022        # vertical amplitude
    x: float = 0.010        # horizontal amplitude
    wave_long: float = 3.2  # long wavelength in ems (baseline drift)
    wave_short: float = 1.15  # short wavelength in ems (per-letter ripple)


FONT_WARP = {"script": Warp()}

# Strokes shorter than this (in em units) are dropped — single-line fonts carry
# tiny degenerate nubs (e.g. a 2-unit cap on "I") that would waste pen dabs.
_MIN_STROKE_UNITS = 6.0
_SKELETON_EM_PX = 224
_SKELETON_MIN_PIXELS = 2
_CENTERLINE_SIMPLIFY_PX = 0.75
_CENTERLINE_SMOOTH_ITERS = 1
_USER_PLOTTER_HUMANIZE = Humanize(
    rotate_deg=1.2,
    scale_var=0.012,
    baseline=0.018,
    x_jitter=0.01,
    advance=0.012,
    vertex=0.0015,
)


def _font_path(font: str) -> Path:
    name = FONT_FILES.get(font)
    if name is None:
        from .services.fonts import user_font_path

        path = user_font_path(font)
        if path is None:
            raise PlotterError(f"Unbekannte Schrift: {font}")
        return path
    path = _FONT_DIR / name
    if not path.exists():
        raise PlotterError(f"Schriftdatei fehlt: {name}")
    return path


@lru_cache(maxsize=8)
def _load_font(font: str) -> TTFont:
    return TTFont(str(_font_path(font)))


def _quad(a: Point, b: Point, c: Point, steps: int = 8) -> Polyline:
    pts: Polyline = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        pts.append((
            mt * mt * a[0] + 2 * mt * t * b[0] + t * t * c[0],
            mt * mt * a[1] + 2 * mt * t * b[1] + t * t * c[1],
        ))
    return pts


def _cubic(a: Point, b: Point, c: Point, d: Point, steps: int = 12) -> Polyline:
    pts: Polyline = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        pts.append((
            mt ** 3 * a[0] + 3 * mt * mt * t * b[0] + 3 * mt * t * t * c[0] + t ** 3 * d[0],
            mt ** 3 * a[1] + 3 * mt * mt * t * b[1] + 3 * mt * t * t * c[1] + t ** 3 * d[1],
        ))
    return pts


def _stroke_length(line: Polyline) -> float:
    return sum(
        ((line[i][0] - line[i - 1][0]) ** 2 + (line[i][1] - line[i - 1][1]) ** 2) ** 0.5
        for i in range(1, len(line))
    )


def _recording_to_strokes(recording: list[tuple[str, tuple]]) -> list[Polyline]:
    """Convert a glyph recording to open polylines. closePath is treated as a
    plain end-of-stroke — we never add the closing segment, since these fonts
    are single-line and closing would double the path."""
    strokes: list[Polyline] = []
    current: Point = (0.0, 0.0)
    line: Polyline = []

    def finish() -> None:
        nonlocal line
        if len(line) > 1 and _stroke_length(line) >= _MIN_STROKE_UNITS:
            strokes.append(line)
        line = []

    for op, args in recording:
        if op == "moveTo":
            finish()
            current = tuple(args[0])
            line = [current]
        elif op == "lineTo":
            current = tuple(args[0])
            line.append(current)
        elif op == "qCurveTo":
            points = [tuple(p) for p in args]
            for i in range(len(points) - 1):
                line.extend(_quad(current, points[i], points[i + 1]))
                current = points[i + 1]
        elif op == "curveTo":
            p1, p2, p3 = (tuple(p) for p in args)
            line.extend(_cubic(current, p1, p2, p3))
            current = p3
        elif op in ("closePath", "endPath"):
            finish()
    finish()
    return strokes


def _recording_to_contours(recording: list[tuple[str, tuple]]) -> list[Polyline]:
    """Flatten a glyph recording into closed contours for raster skeletonizing."""
    contours: list[Polyline] = []
    current: Point = (0.0, 0.0)
    start: Point | None = None
    line: Polyline = []

    def finish(close: bool) -> None:
        nonlocal line, start
        if close and start is not None and line and line[-1] != start:
            line.append(start)
        if len(line) >= 3:
            contours.append(line)
        line = []
        start = None

    for op, args in recording:
        if op == "moveTo":
            finish(close=False)
            current = tuple(args[0])
            start = current
            line = [current]
        elif op == "lineTo":
            current = tuple(args[0])
            line.append(current)
        elif op == "qCurveTo":
            points = [tuple(p) for p in args]
            for i in range(len(points) - 1):
                line.extend(_quad(current, points[i], points[i + 1]))
                current = points[i + 1]
        elif op == "curveTo":
            p1, p2, p3 = (tuple(p) for p in args)
            line.extend(_cubic(current, p1, p2, p3))
            current = p3
        elif op == "closePath":
            finish(close=True)
        elif op == "endPath":
            finish(close=False)
    finish(close=False)
    return contours


def _chaikin(points: np.ndarray, iterations: int) -> np.ndarray:
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


def _skeleton_to_strokes(
    mask: np.ndarray, min_pixels: int = _SKELETON_MIN_PIXELS
) -> list[list[tuple[int, int]]]:
    padded = np.pad(mask.astype(np.uint8), 1)
    rows, cols = np.where(padded > 0)
    if len(rows) == 0:
        return []
    neighbours8 = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
    degree = {
        (int(row), int(col)): int(
            padded[row - 1, col - 1] + padded[row - 1, col] + padded[row - 1, col + 1]
            + padded[row, col - 1] + padded[row, col + 1]
            + padded[row + 1, col - 1] + padded[row + 1, col] + padded[row + 1, col + 1]
        )
        for row, col in zip(rows, cols, strict=True)
    }
    pixels = set(degree)

    def neighbours(p: tuple[int, int]) -> list[tuple[int, int]]:
        r, c = p
        return [(r + dr, c + dc) for dr, dc in neighbours8 if (r + dr, c + dc) in pixels]

    visited_edges: set[frozenset[tuple[int, int]]] = set()
    strokes: list[list[tuple[int, int]]] = []

    def edge(a: tuple[int, int], b: tuple[int, int]) -> frozenset[tuple[int, int]]:
        return frozenset((a, b))

    def walk(a: tuple[int, int], b: tuple[int, int]) -> list[tuple[int, int]]:
        line = [a, b]
        visited_edges.add(edge(a, b))
        prev, cur = a, b
        while degree.get(cur, 0) == 2:
            options = [q for q in neighbours(cur) if q != prev]
            if not options:
                break
            nxt = options[0]
            e = edge(cur, nxt)
            if e in visited_edges:
                break
            visited_edges.add(e)
            line.append(nxt)
            prev, cur = cur, nxt
        return line

    for start in (p for p in pixels if degree[p] != 2):
        for nxt in neighbours(start):
            if edge(start, nxt) not in visited_edges:
                strokes.append(walk(start, nxt))

    for p in pixels:
        for nxt in neighbours(p):
            if edge(p, nxt) not in visited_edges:
                strokes.append(walk(p, nxt))

    # Coordinates were padded by one pixel; shift back to mask space.
    return [
        [(row - 1, col - 1) for row, col in line]
        for line in strokes
        if len(line) >= min_pixels
    ]


def _smooth_skeleton_line(line: list[tuple[int, int]]) -> np.ndarray:
    arr = np.asarray([(col, row) for row, col in line], dtype=np.float32)
    if len(arr) < 3:
        return arr.astype(np.float64)
    approx = cv2.approxPolyDP(arr.reshape(-1, 1, 2), _CENTERLINE_SIMPLIFY_PX, False).reshape(-1, 2)
    if len(approx) < 2:
        approx = arr
    return _chaikin(approx.astype(np.float64), _CENTERLINE_SMOOTH_ITERS)


@lru_cache(maxsize=2048)
def _glyph_centerline(font: str, glyph_name: str) -> list[Polyline]:
    tt = _load_font(font)
    glyph_set = tt.getGlyphSet()
    pen = DecomposingRecordingPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    contours = _recording_to_contours(pen.value)
    if not contours:
        return []

    xs = [x for contour in contours for x, _ in contour]
    ys = [y for contour in contours for _, y in contour]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    units = float(tt["head"].unitsPerEm)
    px_per_unit = _SKELETON_EM_PX / units
    pad = 3
    width = max(4, int(math.ceil((max_x - min_x) * px_per_unit)) + pad * 2 + 1)
    height = max(4, int(math.ceil((max_y - min_y) * px_per_unit)) + pad * 2 + 1)
    mask = np.zeros((height, width), dtype=bool)

    for contour in contours:
        cols = np.array([(x - min_x) * px_per_unit + pad for x, _ in contour])
        rows = np.array([(max_y - y) * px_per_unit + pad for _, y in contour])
        rr, cc = polygon(rows, cols, shape=mask.shape)
        # Toggle contours so counters/holes in glyphs stay hollow.
        mask[rr, cc] = ~mask[rr, cc]

    skeleton = skeletonize(mask)
    strokes: list[Polyline] = []
    for line in _skeleton_to_strokes(skeleton):
        pts: Polyline = []
        smoothed = _smooth_skeleton_line(line)
        for col, row in smoothed:
            x = (col - pad) / px_per_unit + min_x
            y = max_y - (row - pad) / px_per_unit
            pts.append((x, y))
        # Keep short glyph branches (e.g. K/k diagonals) but drop pixel specks.
        if _stroke_length(pts) >= max(_MIN_STROKE_UNITS * 0.25, units * 0.006):
            strokes.append(pts)
    return strokes


_PATH_D_RE = re.compile(r'<path[^>]*\bd="([^"]+)"')


def _svg_glyph_map(tt: TTFont) -> dict[int, str]:
    """gid -> SVG document, built once per font."""
    cached = getattr(tt, "_singleline_svg_map", None)
    if cached is None:
        cached = {}
        if "SVG " in tt:
            for doc in tt["SVG "].docList:
                for gid in range(doc.startGlyphID, doc.endGlyphID + 1):
                    cached[gid] = doc.data
        tt._singleline_svg_map = cached  # type: ignore[attr-defined]
    return cached


def _close(a: Point, b: Point, tol: float) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def _merge_strokes(strokes: list[Polyline], tol: float) -> list[Polyline]:
    """Greedily chain strokes whose endpoints coincide (linemerge). The SVG glyph
    paths split a single pen stroke into several subpaths at shared points; this
    stitches them back into continuous strokes."""
    pool = [list(s) for s in strokes if len(s) >= 2]
    out: list[Polyline] = []
    while pool:
        cur = pool.pop(0)
        extended = True
        while extended:
            extended = False
            for i, s in enumerate(pool):
                if _close(cur[-1], s[0], tol):
                    cur += s[1:]
                elif _close(cur[-1], s[-1], tol):
                    cur += list(reversed(s))[1:]
                elif _close(cur[0], s[-1], tol):
                    cur = s + cur[1:]
                elif _close(cur[0], s[0], tol):
                    cur = list(reversed(s)) + cur[1:]
                else:
                    continue
                pool.pop(i)
                extended = True
                break
        out.append(cur)
    return out


def _glyph_strokes(
    tt: TTFont, glyph_set, glyph_name: str, svg_src: bool, font: str, centerline: bool
) -> list[Polyline]:
    """Open strokes for a glyph in font units (y-up). For SVG fonts we parse the
    single-line <path> from the SVG table and merge its subpaths; otherwise we
    read the (decomposed) CFF/glyf outline."""
    if svg_src:
        gid = tt.getGlyphID(glyph_name)
        data = _svg_glyph_map(tt).get(gid)
        if data:
            raw: list[Polyline] = []
            for d in _PATH_D_RE.findall(data):
                pen = RecordingPen()
                parse_path(d, pen)
                raw += _recording_to_strokes(pen.value)
            return _merge_strokes(raw, tol=4.0)
        # Rare glyphs (e.g. », Ω, arrows) have no SVG art: fall back to the
        # outline so they still appear, rather than rendering nothing.
    if centerline:
        return _glyph_centerline(font, glyph_name)
    pen = DecomposingRecordingPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    return _recording_to_strokes(pen.value)


def _use_centerline(font: str) -> bool:
    if font in FONT_FILES:
        return False
    try:
        from .services.fonts import PLOTTER_MODE, user_font_mode
    except ImportError:
        return False
    return user_font_mode(font) == PLOTTER_MODE


def _warp(lines: list[Polyline], em_mm: float, seed: int, w: Warp) -> list[Polyline]:
    """Apply a smooth sinusoidal warp (baseline drift + gentle ripple) to every
    point. Pure function of position, so connections stay intact."""
    rng = random.Random(seed)
    p1, p2, p3 = (rng.uniform(0, 2 * math.pi) for _ in range(3))
    ay, ax = w.y * em_mm, w.x * em_mm
    k1 = 2 * math.pi / (w.wave_long * em_mm)
    k2 = 2 * math.pi / (w.wave_short * em_mm)
    kx = 2 * math.pi / (w.wave_long * 0.7 * em_mm)
    return [
        [
            (
                x + ax * math.sin(y * kx + p3),
                y + ay * math.sin(x * k1 + p1) + 0.45 * ay * math.sin(x * k2 + p2),
            )
            for x, y in line
        ]
        for line in lines
    ]


def _jitter_word(
    strokes: list[Polyline], j: WordJitter, em_mm: float, rng: random.Random
) -> list[Polyline]:
    """Apply one rigid transform (rotation + scale + offset about the word's
    centre) to every stroke of a word, preserving all internal connections."""
    pts = [p for s in strokes for p in s]
    if not pts:
        return strokes
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    ang = math.radians(rng.uniform(-j.rotate_deg, j.rotate_deg))
    sc = 1 + rng.uniform(-j.scale, j.scale)
    dx = rng.uniform(-j.x, j.x) * em_mm
    dy = rng.uniform(-j.baseline, j.baseline) * em_mm
    ca, sa = math.cos(ang), math.sin(ang)
    out: list[Polyline] = []
    for s in strokes:
        ns: Polyline = []
        for x, y in s:
            ox, oy = (x - cx) * sc, (y - cy) * sc
            ns.append((cx + ox * ca - oy * sa + dx, cy + ox * sa + oy * ca + dy))
        out.append(ns)
    return out


def _humanize_glyph(
    strokes: list[Polyline], h: Humanize, em_mm: float, rng: random.Random
) -> tuple[list[Polyline], float]:
    """Apply a per-glyph rigid transform (+ tiny vertex noise) and return the
    transformed strokes plus an advance-width delta for uneven spacing."""
    advance = rng.uniform(-h.advance, h.advance) * em_mm
    if not strokes:
        return strokes, advance

    xs = [p[0] for s in strokes for p in s]
    ys = [p[1] for s in strokes for p in s]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    ang = math.radians(rng.uniform(-h.rotate_deg, h.rotate_deg))
    sc = 1 + rng.uniform(-h.scale_var, h.scale_var)
    dx = rng.uniform(-h.x_jitter, h.x_jitter) * em_mm
    dy = rng.uniform(-h.baseline, h.baseline) * em_mm
    ca, sa = math.cos(ang), math.sin(ang)
    vj = h.vertex * em_mm

    out: list[Polyline] = []
    for s in strokes:
        ns: Polyline = []
        for x, y in s:
            ox, oy = (x - cx) * sc, (y - cy) * sc
            rx, ry = ox * ca - oy * sa, ox * sa + oy * ca
            jx = rng.uniform(-vj, vj) if vj else 0.0
            jy = rng.uniform(-vj, vj) if vj else 0.0
            ns.append((cx + rx + dx + jx, cy + ry + dy + jy))
        out.append(ns)
    return out, advance


def text_polylines(
    text: str, *, font: str = "sans", size: float = 12.0, connect_spaces: bool = False
) -> list[list[list[float]]]:
    """Render text to single-line polylines in mm, y-down (editor space).

    ``connect_spaces`` (cursive fonts only) adds a baseline sweep across each
    space so a whole line reads as one continuous flourish.
    """
    if size <= 0:
        raise PlotterError("Schriftgröße muss größer als 0 sein.")
    if not text:
        return []

    tt = _load_font(font)
    cmap = tt.getBestCmap() or {}
    glyph_set = tt.getGlyphSet()
    units = float(tt["head"].unitsPerEm)
    scale = size / units
    hhea = tt["hhea"]
    ascent = float(hhea.ascent)
    descent = float(hhea.descent)
    line_height = (ascent - descent) * scale * 1.25
    baseline = ascent * scale
    cursor = 0.0
    connect = font in FONT_CONNECT
    svg_src = font in FONT_SVG
    centerline = _use_centerline(font)
    human = FONT_HUMANIZE.get(font) or (_USER_PLOTTER_HUMANIZE if centerline else None)
    jitter = FONT_WORD_JITTER.get(font)
    sweep_spaces = connect_spaces and connect
    prev_word_end: Point | None = None  # (x, baseline) right edge of the last word

    # Cursive fonts build one stroke per word: each letter's main stroke joins
    # `word_bodies`; its dots/accents/crossbars go to `word_marks`. On a word
    # break the bodies are linemerged (and optionally jittered as a unit) into
    # the page mains; marks are emitted after all mains so they don't break flow.
    mains: list[Polyline] = []
    marks: list[Polyline] = []
    word_bodies: list[Polyline] = []
    word_marks: list[Polyline] = []
    word_no = 0

    def flush_word() -> None:
        nonlocal word_bodies, word_marks, word_no
        if word_bodies or word_marks:
            merged = _merge_strokes(word_bodies, tol=0.3)
            group_marks = word_marks
            if jitter:
                rng = random.Random(zlib.crc32(f"{font}|{word_no}".encode()))
                combined = _jitter_word(merged + group_marks, jitter, size, rng)
                merged, group_marks = combined[: len(merged)], combined[len(merged):]
            mains.extend(merged)
            marks.extend(group_marks)
        word_bodies, word_marks = [], []
        word_no += 1

    for gi, ch in enumerate(text):
        if ch == "\n":
            cursor = 0.0
            baseline += line_height
            flush_word()
            prev_word_end = None  # never sweep across a line break
            continue
        glyph_name = cmap.get(ord(ch))
        if glyph_name is None or ch == " ":
            if sweep_spaces and (word_bodies or word_marks):
                prev_word_end = (cursor, baseline)  # right edge of the word
            cursor += glyph_set[glyph_name].width * scale if glyph_name else size * 0.4
            flush_word()
            continue

        # First glyph of a word: bridge from the previous word along the baseline.
        if sweep_spaces and not word_bodies and not word_marks and prev_word_end is not None:
            if prev_word_end[1] == baseline and cursor > prev_word_end[0]:
                mains.append([prev_word_end, (cursor, baseline)])
            prev_word_end = None

        strokes = [
            [(cursor + x * scale, baseline - y * scale) for x, y in raw]
            for raw in _glyph_strokes(tt, glyph_set, glyph_name, svg_src, font, centerline)
        ]
        if human:
            # Seed per (font, position, char): stable across re-renders, while
            # repeated letters still vary by where they sit.
            rng = random.Random(zlib.crc32(f"{font}|{gi}|{ch}".encode()))
            strokes, advance = _humanize_glyph(strokes, human, size, rng)
            cursor += advance

        if connect and strokes:
            body = max(strokes, key=_stroke_length)  # the letter's main stroke
            word_bodies.append(body)
            word_marks.extend(s for s in strokes if s is not body)
        else:
            mains.extend(strokes)
        cursor += glyph_set[glyph_name].width * scale

    flush_word()
    out = mains + marks
    if font in FONT_WARP:
        out = _warp(out, size, zlib.crc32(text.encode()), FONT_WARP[font])
    return [[[round(x, 3), round(y, 3)] for x, y in line] for line in out]
