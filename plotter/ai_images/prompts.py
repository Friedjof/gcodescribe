from __future__ import annotations

import hashlib

from .errors import AiImageError

# Prompt length caps so a stray paste can't blow up the request or cost.
MAX_INSTRUCTIONS_LEN = 2000
MAX_FEEDBACK_LEN = 1000

# The style prompt is English even though the UI is German: image models follow
# English instructions more reliably. It is deliberately prescriptive so the
# raster output vectorizes cleanly — the gallery trace step needs crisp, solid
# black-on-white edges, not soft or gray ones.
STYLE_PROMPT = (
    "Redraw the main subject of the reference image as a clean black-and-white "
    "line drawing for a pen plotter, in the style of a coloring-book outline.\n"
    "Hard requirements:\n"
    "- Pure white (#FFFFFF) background, completely empty — no scenery, frame, "
    "border, or vignette.\n"
    "- Lines in pure black (#000000) only. No gray, no color, no gradients.\n"
    "- Crisp, hard-edged strokes of uniform medium thickness. No anti-aliasing, "
    "no blur, no soft or feathered edges, no pencil/charcoal texture.\n"
    "- Smooth, long, continuous outlines that form closed shapes wherever "
    "possible; reduce the subject to its essential contours plus only a few key "
    "interior lines.\n"
    "- Keep large empty white areas. Do not fill anything solid black.\n"
    "Strictly avoid: shading, hatching, cross-hatching, stippling, dots, "
    "texture, tiny isolated strokes, shadows, halftone, and dense fine detail.\n"
    "The image will be vectorized into SVG paths and drawn by a single pen, so "
    "it must trace into a small number of long, clean paths with few pen lifts."
)


def style_prompt_hash() -> str:
    return hashlib.sha256(STYLE_PROMPT.encode()).hexdigest()[:16]


def _clip(text: str, limit: int, label: str) -> str:
    text = (text or "").strip()
    if len(text) > limit:
        raise AiImageError(
            "unsupported_file", f"{label} ist zu lang (max. {limit} Zeichen)."
        )
    return text


def compose_prompt(instructions: str = "", feedback: str = "") -> str:
    """Final model prompt: fixed plotter style + optional user additions.

    The default style is always kept; user instructions and feedback are
    appended so the user can refine without losing the plotter constraints.
    """
    instructions = _clip(instructions, MAX_INSTRUCTIONS_LEN, "Zusatzanweisungen")
    feedback = _clip(feedback, MAX_FEEDBACK_LEN, "Feedback")
    parts = [STYLE_PROMPT]
    if instructions:
        parts.append(f"User instructions: {instructions}")
    if feedback:
        parts.append(
            "If feedback is provided, improve the previous result according to it "
            "while keeping the plotter-ready line style.\n"
            f"Feedback: {feedback}"
        )
    return "\n\n".join(parts)
