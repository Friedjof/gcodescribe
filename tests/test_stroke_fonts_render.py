from __future__ import annotations

from plotter.stroke_fonts.matching import missing_characters, tokenize
from plotter.stroke_fonts.model import empty_document, normalize_document
from plotter.stroke_fonts.render import render_text
from plotter.stroke_fonts.speed import stroke_feeds


def _doc_with_glyphs() -> dict:
    raw = {
        "label": "Test",
        "glyphs": [
            {
                "key": "a",
                "type": "character",
                "variants": [
                    {
                        "weight": 1.0,
                        "strokes": [
                            {
                                "rawPoints": [],
                                "points": [
                                    {"x": 0, "y": 0, "t": 0},
                                    {"x": 200, "y": 400, "t": 40},
                                ],
                            }
                        ],
                    }
                ],
            },
            {
                "key": "ff",
                "type": "ligature",
                "variants": [
                    {
                        "weight": 1.0,
                        "strokes": [
                            {"rawPoints": [], "points": [{"x": 0, "y": 0}, {"x": 50, "y": 700}]}
                        ],
                    }
                ],
            },
        ],
    }
    return normalize_document(raw, font_id="stroke-render1")


# ---- matching -----------------------------------------------------------

def test_tokenize_longest_match_prefers_ligature():
    tokens = tokenize("ffa", {"a", "ff"})
    assert [(t.kind, t.value) for t in tokens] == [
        ("glyph", "ff"),
        ("glyph", "a"),
    ]


def test_tokenize_reports_missing_and_whitespace():
    tokens = tokenize("a z\nb", {"a"})
    kinds = [(t.kind, t.value) for t in tokens]
    assert ("space", " ") in kinds
    assert ("newline", "\n") in kinds
    assert ("missing", "z") in kinds
    assert ("missing", "b") in kinds
    assert missing_characters(tokens) == ["z", "b"]


# ---- render -------------------------------------------------------------

def test_render_produces_polylines_for_known_glyphs():
    doc = _doc_with_glyphs()
    result = render_text(doc, "a", size=10)
    assert len(result.polylines) == 1
    assert all(len(pt) == 2 for pt in result.polylines[0])
    assert result.missing == []


def test_render_scales_to_size_and_is_y_down():
    doc = _doc_with_glyphs()
    result = render_text(doc, "a", size=10)
    line = result.polylines[0]
    # em=1000, scale = 10/1000 = 0.01; baseline (y_up=0) -> ascender*scale below top.
    ascender = doc["metrics"]["ascender"]
    assert line[0][1] == ascender * 0.01  # first point y_up=0 → y-down = ascender*scale
    # Second point has higher y_up (400) → smaller y-down value (closer to top).
    assert line[1][1] < line[0][1]


def test_render_reports_missing_characters():
    doc = _doc_with_glyphs()
    result = render_text(doc, "axy", size=10)
    assert result.missing == ["x", "y"]
    assert len(result.polylines) == 1  # only 'a' rendered


def test_render_longest_match_uses_ligature_glyph():
    doc = _doc_with_glyphs()
    one = render_text(doc, "ff", size=10)
    # 'ff' matches the ligature (one stroke), not two 'f' glyphs (absent).
    assert len(one.polylines) == 1
    assert one.missing == []


def test_render_advances_cursor_between_glyphs():
    doc = _doc_with_glyphs()
    result = render_text(doc, "aa", size=10)
    assert len(result.polylines) == 2
    # Second 'a' is shifted right by the advance.
    assert result.polylines[1][0][0] > result.polylines[0][0][0]


def test_render_empty_text_is_empty():
    assert render_text(_doc_with_glyphs(), "", size=10).polylines == []


def test_render_empty_font_renders_nothing_but_lists_missing():
    doc = empty_document("Empty", font_id="stroke-empty")
    result = render_text(doc, "hi", size=10)
    assert result.polylines == []
    assert result.missing == ["h", "i"]


# ---- speed --------------------------------------------------------------

def test_stroke_feeds_vary_with_timing_within_bounds():
    # Equal spatial steps but increasing dt → decreasing speed → lower feed.
    points = [
        {"x": 0, "y": 0, "t": 0},
        {"x": 10, "y": 0, "t": 10},   # fast
        {"x": 20, "y": 0, "t": 40},   # slower
        {"x": 30, "y": 0, "t": 100},  # slowest
    ]
    feeds = stroke_feeds(points, 1500.0)
    assert len(feeds) == len(points)
    assert all(1500 * 0.65 - 1e-6 <= f <= 1500 * 1.25 + 1e-6 for f in feeds)
    # Faster early segment gets a higher feed than the slow late one.
    assert feeds[1] > feeds[3]


def test_stroke_feeds_clamps_to_safety_band():
    points = [
        {"x": 0, "y": 0, "t": 0},
        {"x": 1000, "y": 0, "t": 1},   # absurdly fast
        {"x": 1001, "y": 0, "t": 5000},  # crawling
    ]
    feeds = stroke_feeds(points, 1500.0, floor=1000.0, ceil=2000.0)
    assert all(1000.0 <= f <= 2000.0 for f in feeds)


def test_stroke_feeds_without_timing_is_constant():
    points = [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 20, "y": 0}]
    feeds = stroke_feeds(points, 1500.0)
    assert feeds == [1500.0, 1500.0, 1500.0]
