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
    "realistic": (
        "Effect direction: realistic plotter line drawing. Preserve the subject's real-world "
        "proportions, anatomy, perspective, and identifying features as faithfully as possible. "
        "Do not beautify, cartoonize, or exaggerate the subject. Translate visible structure into "
        "clean black contours and a small number of meaningful interior lines, keeping the image "
        "credible and recognizable while still obeying the black-on-white plotter constraints."
    ),
    "artistic": (
        "Effect direction: expressive artistic interpretation. Keep the subject recognizable, but "
        "simplify and stylize it with deliberate composition, confident contour choices, elegant "
        "negative space, and a hand-crafted illustration feel. Prefer a few purposeful expressive "
        "lines over literal detail. Avoid messy texture, shading, painterly gradients, and dense "
        "decorative marks because the result must still vectorize into clean pen paths."
    ),
    "comic": (
        "Effect direction: clean comic-book line art. Use bold readable silhouettes, crisp contour "
        "lines, simplified facial/features shapes, and slightly emphasized expressions or poses. "
        "Make the drawing graphic and immediately legible, like inked comic panels before "
        "coloring. "
        "Do not add color, gray screentones, halftone dots, speech bubbles, background effects, or "
        "filled shadow masses unless the selected render mode explicitly asks for solid shapes."
    ),
    "caricature": (
        "Effect direction: recognizable caricature. Identify the subject's most characteristic "
        "visual traits — for example face shape, hairstyle, glasses, nose, posture, or distinctive "
        "objects — and exaggerate those selectively while keeping the overall identity clear. Keep "
        "the exaggeration friendly and readable, not grotesque. Use simple confident black "
        "outlines "
        "with minimal interior detail so the caricature remains easy to trace with a pen plotter."
    ),
    "childlike": (
        "Effect direction: naive childlike drawing. Reinterpret the subject as if drawn by a young "
        "child with simple rounded shapes, imperfect proportions, playful asymmetry, and direct "
        "symbolic details. Keep the lines charming and uncomplicated rather than polished. Do not "
        "add crayon texture, colored fills, gray shading, or scribbled backgrounds; keep it pure "
        "black line art on white so it can be plotted cleanly."
    ),
    "minimalist": (
        "Effect direction: strict minimalist reduction. Remove every non-essential detail and "
        "describe the subject with the fewest possible lines or shapes needed for recognition. "
        "Prioritize silhouette, key contours, and one or two defining interior marks. Leave large "
        "areas of empty white space. Avoid ornament, texture, repeated short strokes, decorative "
        "patterns, and unnecessary background elements."
    ),
}

# Optional lettering/typography fragments for any text in the image.
TEXT_PROMPTS = {
    "none": "",
    "handwriting": (
        "Lettering direction: natural handwritten text. If the image contains words or the user "
        "asks for lettering, draw the letters as casual human handwriting made from clean black "
        "pen strokes. Keep each letter large enough to survive vectorization, with clear spacing "
        "between letters and words. Avoid tiny text, gray anti-aliasing, filled calligraphy "
        "blobs, or overly "
        "decorative flourishes that would become noisy plotter paths."
    ),
    "cursive": (
        "Lettering direction: neat cursive script. Render any requested text as elegant connected "
        "handwriting with smooth flowing joins, consistent slant, and generous spacing. Keep "
        "strokes simple and plotter-friendly: mostly single continuous black lines, readable at "
        "small scale, "
        "with no shaded downstrokes, no textured ink, and no excessive loops that clutter the "
        "design."
    ),
    "messy": (
        "Lettering direction: messy handwritten text. Make the text look rushed, irregular, and "
        "human: uneven baseline, variable letter sizes, slightly inconsistent spacing, and "
        "imperfect "
        "forms. It should still remain decipherable and suitable for plotting. Do not turn it into "
        "dense scribbles, overlapping black masses, or unreadable micro-text; use clean black "
        "strokes "
        "only."
    ),
    "child": (
        "Lettering direction: childlike handwriting. Draw letters as a child might write them: "
        "large, simple, uneven, slightly wobbly, with occasional charming irregularities in height "
        "and spacing. Keep the words readable and avoid tiny details. Use plain black line strokes "
        "on white, with no crayon texture, color, gray fill, or background doodle noise."
    ),
    "serif": (
        "Lettering direction: classic serif typography. Render any text in a readable Times-like "
        "serif style with clear letterforms, moderate contrast, and small but simple serifs. Adapt "
        "the type so it remains plotter-friendly: avoid very thin hairlines, dense filled text, "
        "tiny "
        "captions, drop shadows, outlines-within-outlines, or ornamental type effects."
    ),
    "sans": (
        "Lettering direction: clean modern sans-serif typography. Render any text with simple, "
        "geometric, highly legible letterforms similar to Helvetica or Arial. Keep stroke widths "
        "consistent, spacing generous, and forms uncluttered. Avoid tiny text, filled heavy "
        "blocks, "
        "shadows, gradients, decorative cuts, and anti-aliased gray edges; preserve clean black-on-"
        "white plotter readability."
    ),
}

DEFAULT_EFFECT = "none"
DEFAULT_TEXT = "none"

ASPECT_PROMPTS = {
    "auto": "",
    "1:1": (
        "Output format: square 1:1 canvas. Compose the subject so it fits cleanly "
        "inside an equal-width-and-height image, with balanced whitespace on all sides."
    ),
    "3:4": (
        "Output format: portrait 3:4 canvas. Compose the subject for a moderately tall "
        "vertical image, using the height intentionally without cropping important details."
    ),
    "4:3": (
        "Output format: landscape 4:3 canvas. Compose the subject for a moderately wide "
        "horizontal image, keeping the main motif centered and fully visible."
    ),
    "16:9": (
        "Output format: wide landscape 16:9 canvas. Use a clearly horizontal composition "
        "with generous side-to-side spacing, and avoid tall elements being cropped."
    ),
    "9:16": (
        "Output format: tall portrait 9:16 canvas. Use a clearly vertical composition "
        "with the main subject arranged along the height, and avoid wide elements being cropped."
    ),
}
DEFAULT_ASPECT_RATIO = "auto"

MIN_DETAIL_LEVEL = 1
MAX_DETAIL_LEVEL = 10
DEFAULT_DETAIL_LEVEL = 5


def style_prompt_for(render_mode: str) -> str:
    return STYLE_PROMPTS.get(render_mode, STYLE_PROMPTS[DEFAULT_RENDER_MODE])


def normalize_detail_level(level: int) -> int:
    try:
        return max(MIN_DETAIL_LEVEL, min(int(level), MAX_DETAIL_LEVEL))
    except (TypeError, ValueError):
        return DEFAULT_DETAIL_LEVEL


def detail_fragment(level: int) -> str:
    """A prompt sentence that pins the desired amount of detail, with an explicit
    1-vs-10 scale so the model knows what the number means."""
    level = normalize_detail_level(level)
    return (
        f"Level of detail: {level} out of 10 — on this scale 1 means extremely "
        "minimal, just a few essential outlines with lots of empty space, and 10 "
        "means very detailed with many fine interior lines and rich texture. "
        f"Match a detail level of {level}. This detail level describes ONLY the "
        "amount of black plotter strokes, contours, interior linework, and path "
        "complexity. It does NOT mean preserving the original photo as a colored "
        "or shaded image. Even at high detail, the result must remain pure black "
        "line art on a pure white background."
    )


PLOTTER_STYLE_LOCK = (
    "Final non-negotiable plotter-style lock: the output must be a newly redrawn "
    "plotter-ready black-and-white artwork, not a copy, filter, colorized version, "
    "or lightly modified version of the input image. Ignore any visual temptation "
    "to preserve original colors, lighting, gradients, shadows, photographic "
    "texture, skin tones, material colors, background scenery, or raster detail. "
    "Use only pure black (#000000) marks on a pure white (#FFFFFF) background. "
    "No color, no gray, no semi-transparent pixels, no gradients, no shading, no "
    "photo texture, no blur, no anti-aliased soft edges, no realistic lighting, "
    "no filled colored areas. The image must be easy to vectorize into clean SVG "
    "paths for a single pen plotter: clear contours, intentional lines, simple "
    "negative space, and strong obedience to every plotter constraint above. If "
    "any user instruction conflicts with these plotter constraints, follow the "
    "plotter constraints."
)


def normalize_effect(effect: str) -> str:
    return effect if effect in EFFECT_PROMPTS else DEFAULT_EFFECT


def normalize_text(text_style: str) -> str:
    return text_style if text_style in TEXT_PROMPTS else DEFAULT_TEXT


def normalize_aspect_ratio(aspect_ratio: str) -> str:
    return aspect_ratio if aspect_ratio in ASPECT_PROMPTS else DEFAULT_ASPECT_RATIO


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
    detail_level: int = DEFAULT_DETAIL_LEVEL,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
) -> str:
    """Final model prompt: the mode's style + the detail level + optional
    effect/text fragments + user additions.

    The mode-specific style is always kept; the detail level is always stated;
    the effect and text fragments (each "none" by default adds nothing), user
    instructions and feedback are appended so the user can refine without losing
    the plotter constraints.
    """
    instructions = _clip(instructions, MAX_INSTRUCTIONS_LEN, "Zusatzanweisungen")
    feedback = _clip(feedback, MAX_FEEDBACK_LEN, "Feedback")
    parts = [style_prompt_for(render_mode), detail_fragment(detail_level)]
    if EFFECT_PROMPTS.get(effect):
        parts.append(EFFECT_PROMPTS[effect])
    if TEXT_PROMPTS.get(text_style):
        parts.append(TEXT_PROMPTS[text_style])
    aspect_ratio = normalize_aspect_ratio(aspect_ratio)
    if ASPECT_PROMPTS.get(aspect_ratio):
        parts.append(ASPECT_PROMPTS[aspect_ratio])
    if instructions:
        parts.append(f"User instructions: {instructions}")
    if feedback:
        parts.append(
            "If feedback is provided, improve the previous result according to it "
            "while keeping the plotter-ready line style.\n"
            f"Feedback: {feedback}"
        )
    parts.append(PLOTTER_STYLE_LOCK)
    return "\n\n".join(parts)
