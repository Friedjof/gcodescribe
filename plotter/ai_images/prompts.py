from __future__ import annotations

import hashlib

from .errors import AiImageError

# Prompt length caps so a stray paste can't blow up the request or cost.
MAX_INSTRUCTIONS_LEN = 2000
MAX_FEEDBACK_LEN = 1000

# The style prompt is English even though the UI is German: image models follow
# English instructions more reliably. It tells the model to produce a technical
# plotter intermediate, not a pretty picture.
STYLE_PROMPT = (
    "Transform the provided reference image into a plotter-ready black ink line "
    "drawing on a pure white background. Use only thin black pen lines. Prefer "
    "long continuous strokes, clean contours, and a small number of meaningful "
    "interior lines. Avoid dots, stippling, texture, tiny isolated strokes, "
    "grayscale, shadows, filled areas, hatching, and dense detail. The output "
    "will be converted to SVG paths and drawn by a pen plotter, so it must be "
    "easy to trace into clean vector lines with few pen lifts."
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
