from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ...calibration import Calibration
from ...coloring_pages import ColoringPageGenerator

router = APIRouter(tags=["coloring-pages"])


@router.get("/coloring-pages")
def coloring_page(
    function: str = Query("mandala", pattern="^(mandala|math_pattern)$"),
    mode: str = Query("flower", min_length=1, max_length=32),
    seed: str = Query("demo", min_length=1, max_length=128),
    width: float = Query(180, ge=60, le=2000),
    height: float = Query(180, ge=60, le=2000),
    margin: float = Query(5.0, ge=0.0, le=80.0),
    stroke_width: float = Query(1.0, ge=0.1, le=5.0),
    complexity: float = Query(0.4, ge=0.0, le=1.0),
    show_seed: bool = Query(False),
    age_group: str = Query("6-8", pattern="^(4-6|6-8|8-10)$"),
    variant_size: float | None = Query(None, ge=4.0, le=1000.0),
) -> dict:
    cal = Calibration.load()
    width = max(60.0, min(width, cal.plot_width))
    height = max(60.0, min(height, cal.plot_height))
    generator = ColoringPageGenerator()
    try:
        if function == "mandala":
            page = generator.generate_mandala_page(
                seed=seed,
                mode=mode,
                width_mm=width,
                height_mm=height,
                margin_mm=margin,
                radius_mm=variant_size,
                stroke_width_mm=stroke_width,
                complexity=complexity,
                age_group=age_group,
                show_seed=show_seed,
            )
        else:
            page = generator.generate_math_pattern_page(
                seed=seed,
                mode=mode,
                width_mm=width,
                height_mm=height,
                margin_mm=margin,
                stroke_width_mm=stroke_width,
                complexity=complexity,
                age_group=age_group,
                cell_size_mm=variant_size,
                show_seed=show_seed,
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "function": function,
        "mode": mode,
        "seed": seed,
        "width": page.width_mm,
        "height": page.height_mm,
        "viewBox": f"0 0 {page.width_mm:g} {page.height_mm:g}",
        "svg": page.svg,
        "lines": page.polylines,
        "metadata": page.metadata,
    }
