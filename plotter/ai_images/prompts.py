from __future__ import annotations

import hashlib

from .errors import AiImageError

# Prompt length caps so a stray paste can't blow up the request or cost.
MAX_INSTRUCTIONS_LEN = 2000
MAX_FEEDBACK_LEN = 1000

# One style prompt per render mode, so the mode selector actually changes the
# generated image (not just the local vectorization). Prompts are English even
# though the UI is German — image models follow English more reliably — and are
# deliberately prescriptive so the gallery trace step gets crisp black-on-white.
#
# - edges: outline tracer → clean coloring-book contours, no fills.
# - handwriting: centreline tracer → single-stroke gestural sketch.
# - trace: outline tracer over solid black regions → bold stencil/silhouette.
STYLE_PROMPTS = {
    "edges": (
        "Redraw the main subject of the reference image as a clean coloring-book "
        "outline for a pen plotter.\n"
        "Hard requirements:\n"
        "- Pure white (#FFFFFF) background, completely empty — no scenery, frame, "
        "border, or vignette.\n"
        "- Lines in pure black (#000000) only. No gray, no color, no gradients.\n"
        "- Crisp, hard-edged strokes of uniform medium thickness. No anti-aliasing, "
        "no blur, no soft or feathered edges, no pencil/charcoal texture.\n"
        "- Smooth, long, continuous outlines that form closed shapes wherever "
        "possible; reduce the subject to its main contours plus only a few key "
        "interior lines.\n"
        "- Keep large empty white areas. Do NOT fill any area solid black.\n"
        "Strictly avoid: shading, hatching, stippling, dots, texture, tiny "
        "isolated strokes, shadows, halftone, and dense fine detail.\n"
        "The image is vectorized into SVG paths drawn by a single pen, so it must "
        "trace into a small number of long, clean outline paths."
    ),
    "handwriting": (
        "Redraw the main subject of the reference image as a loose single-line ink "
        "sketch for a pen plotter, in the style of a continuous one-line drawing.\n"
        "Hard requirements:\n"
        "- Pure white (#FFFFFF) background, completely empty.\n"
        "- Thin, uniform, pure black (#000000) strokes only. No gray, no color.\n"
        "- Flowing, gestural, hand-drawn lines — ideally one continuous path with "
        "very few pen lifts.\n"
        "- Each contour is a SINGLE centreline stroke; never double an outline.\n"
        "- Crisp hard edges: no anti-aliasing, no blur, no shading, no fills, no "
        "hatching, no texture, no dots.\n"
        "Capture the subject with the minimum number of essential strokes, so it "
        "traces into a few long, open polylines."
    ),
    "trace": (
        "Convert the main subject of the reference image into a bold black-and-"
        "white stencil for a pen plotter, like high-contrast pop-art or a "
        "paper-cut silhouette.\n"
        "Hard requirements:\n"
        "- Pure white (#FFFFFF) background, completely empty.\n"
        "- Exactly two tones: pure black (#000000) and pure white. No gray, no "
        "gradients, no anti-aliasing, no halftone.\n"
        "- Render the subject as a few LARGE solid black shapes with clean, smooth "
        "boundaries; connected black regions read as bold filled silhouettes with "
        "simple white cut-out details inside.\n"
        "- Keep shapes large and simple. Avoid thin scattered marks, stippling, "
        "dots, fine texture, and isolated specks.\n"
        "The solid black regions are traced into clean outline paths, so every "
        "edge must be smooth and continuous."
    ),
}

DEFAULT_RENDER_MODE = "edges"

# Optional effect/look fragments, combined into the prompt. "none" adds nothing.
EFFECT_PROMPTS = {
    "none": "",
    "realistic": "Keep the proportions and features realistic and true to the reference.",
    "artistic": "Give it an expressive, artistic interpretation with confident, stylized strokes.",
    "comic": "Render it in a bold comic-book style with clear, slightly exaggerated outlines.",
    "caricature": (
        "Exaggerate the most characteristic features like a caricature, "
        "while keeping the subject clearly recognizable."
    ),
    "childlike": "Draw it in a naive, childlike hand-drawn style with simple, playful shapes.",
    "minimalist": "Reduce it to a minimalist drawing using only the few most essential lines.",
}

# Optional lettering/typography fragments for any text in the image.
TEXT_PROMPTS = {
    "none": "",
    "handwriting": "Render any text or lettering as natural human handwriting.",
    "cursive": "Render any text or lettering as neat, elegant cursive handwriting.",
    "messy": "Render any text or lettering as messy, barely legible handwriting.",
    "child": "Render any text or lettering as clumsy childlike handwriting.",
    "serif": "Render any text or lettering in a classic serif typeface like Times New Roman.",
    "sans": "Render any text or lettering in a clean, modern sans-serif typeface.",
}

DEFAULT_EFFECT = "none"
DEFAULT_TEXT = "none"


def style_prompt_for(render_mode: str) -> str:
    return STYLE_PROMPTS.get(render_mode, STYLE_PROMPTS[DEFAULT_RENDER_MODE])


def normalize_effect(effect: str) -> str:
    return effect if effect in EFFECT_PROMPTS else DEFAULT_EFFECT


def normalize_text(text_style: str) -> str:
    return text_style if text_style in TEXT_PROMPTS else DEFAULT_TEXT


def style_prompt_hash(render_mode: str = DEFAULT_RENDER_MODE) -> str:
    return hashlib.sha256(style_prompt_for(render_mode).encode()).hexdigest()[:16]


def _clip(text: str, limit: int, label: str) -> str:
    text = (text or "").strip()
    if len(text) > limit:
        raise AiImageError(
            "unsupported_file", f"{label} ist zu lang (max. {limit} Zeichen)."
        )
    return text


def compose_prompt(
    instructions: str = "",
    feedback: str = "",
    render_mode: str = DEFAULT_RENDER_MODE,
    effect: str = DEFAULT_EFFECT,
    text_style: str = DEFAULT_TEXT,
) -> str:
    """Final model prompt: the mode's style + optional effect/text/look fragments
    + user additions.

    The mode-specific style is always kept; the effect and text fragments (each
    "none" by default adds nothing), user instructions and feedback are appended
    so the user can refine without losing the plotter constraints.
    """
    instructions = _clip(instructions, MAX_INSTRUCTIONS_LEN, "Zusatzanweisungen")
    feedback = _clip(feedback, MAX_FEEDBACK_LEN, "Feedback")
    parts = [style_prompt_for(render_mode)]
    if EFFECT_PROMPTS.get(effect):
        parts.append(EFFECT_PROMPTS[effect])
    if TEXT_PROMPTS.get(text_style):
        parts.append(TEXT_PROMPTS[text_style])
    if instructions:
        parts.append(f"User instructions: {instructions}")
    if feedback:
        parts.append(
            "If feedback is provided, improve the previous result according to it "
            "while keeping the plotter-ready line style.\n"
            f"Feedback: {feedback}"
        )
    return "\n\n".join(parts)
