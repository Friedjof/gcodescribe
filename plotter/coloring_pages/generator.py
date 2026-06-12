from __future__ import annotations

from typing import Any

from .mandala import mandala_lines
from .math_patterns import pattern_lines
from .seed import create_rng, normalize_seed
from .svg import create_svg_canvas, rounded_lines, validate_plotter_safety
from .types import ColoringPage


class ColoringPageGenerator:
    def normalize_seed(self, seed: int | str) -> int:
        return normalize_seed(seed)

    def create_svg_canvas(
        self,
        width_mm: float,
        height_mm: float,
        lines: list,
        metadata: dict[str, Any],
        stroke_width_mm: float,
    ) -> str:
        return create_svg_canvas(width_mm, height_mm, lines, metadata, stroke_width_mm)

    def add_metadata(self, metadata: dict[str, Any]) -> dict[str, Any]:
        return metadata

    def validate_plotter_safety(self, lines: list, width_mm: float, height_mm: float) -> None:
        validate_plotter_safety(lines, width_mm, height_mm)

    def generate_mandala_coloring_page(
        self,
        seed: int | str,
        mode: str,
        width_mm: float,
        height_mm: float,
        margin_mm: float = 5.0,
        radius_mm: float | None = None,
        stroke_width_mm: float = 1.0,
        complexity: float = 0.4,
        age_group: str = "6-8",
        radial_order: int | None = None,
        ring_count: int | None = None,
        min_gap_mm: float = 6.0,
        symmetry_strength: float = 1.0,
        closed_shapes_only: bool = True,
        outer_frame: bool = True,
        output_format: str = "svg",
    ) -> str:
        return self.generate_mandala_page(
            seed,
            mode,
            width_mm,
            height_mm,
            margin_mm,
            radius_mm,
            stroke_width_mm,
            complexity,
            age_group,
            radial_order,
            ring_count,
            min_gap_mm,
            symmetry_strength,
            closed_shapes_only,
            outer_frame,
            output_format,
        ).svg

    def generate_mandala_page(
        self,
        seed: int | str,
        mode: str,
        width_mm: float,
        height_mm: float,
        margin_mm: float = 5.0,
        radius_mm: float | None = None,
        stroke_width_mm: float = 1.0,
        complexity: float = 0.4,
        age_group: str = "6-8",
        radial_order: int | None = None,
        ring_count: int | None = None,
        min_gap_mm: float = 6.0,
        symmetry_strength: float = 1.0,
        closed_shapes_only: bool = True,
        outer_frame: bool = True,
        output_format: str = "svg",
    ) -> ColoringPage:
        if output_format != "svg":
            raise ValueError("Only svg output is supported.")
        normalized, rng = create_rng(seed)
        lines, derived = mandala_lines(
            rng,
            mode,
            width_mm,
            height_mm,
            margin_mm,
            radius_mm,
            complexity,
            age_group,
            radial_order,
            ring_count,
            min_gap_mm,
            outer_frame,
        )
        lines = rounded_lines(lines)
        self.validate_plotter_safety(lines, width_mm, height_mm)
        metadata = self.add_metadata({
            "generator": "plotter-coloring-pages",
            "category": "coloring_pages",
            "function": "generate_mandala_coloring_page",
            "mode": mode,
            "seed": str(seed),
            "normalized_seed": normalized,
            "width_mm": width_mm,
            "height_mm": height_mm,
            "margin_mm": margin_mm,
            "stroke_width_mm": stroke_width_mm,
            "complexity": complexity,
            "age_group": age_group,
            "min_gap_mm": min_gap_mm,
            "symmetry_strength": symmetry_strength,
            "closed_shapes_only": closed_shapes_only,
            "outer_frame": outer_frame,
            **derived,
        })
        svg = self.create_svg_canvas(width_mm, height_mm, lines, metadata, stroke_width_mm)
        return ColoringPage(svg, lines, width_mm, height_mm, metadata)

    def generate_math_pattern_coloring_page(
        self,
        seed: int | str,
        mode: str,
        width_mm: float,
        height_mm: float,
        margin_mm: float = 5.0,
        stroke_width_mm: float = 1.0,
        complexity: float = 0.4,
        age_group: str = "6-8",
        cell_size_mm: float | None = None,
        min_gap_mm: float = 6.0,
        jitter: float = 0.2,
        density: float = 0.5,
        closed_shapes_only: bool = True,
        outer_frame: bool = True,
        output_format: str = "svg",
    ) -> str:
        return self.generate_math_pattern_page(
            seed,
            mode,
            width_mm,
            height_mm,
            margin_mm,
            stroke_width_mm,
            complexity,
            age_group,
            cell_size_mm,
            min_gap_mm,
            jitter,
            density,
            closed_shapes_only,
            outer_frame,
            output_format,
        ).svg

    def generate_math_pattern_page(
        self,
        seed: int | str,
        mode: str,
        width_mm: float,
        height_mm: float,
        margin_mm: float = 5.0,
        stroke_width_mm: float = 1.0,
        complexity: float = 0.4,
        age_group: str = "6-8",
        cell_size_mm: float | None = None,
        min_gap_mm: float = 6.0,
        jitter: float = 0.2,
        density: float = 0.5,
        closed_shapes_only: bool = True,
        outer_frame: bool = True,
        output_format: str = "svg",
    ) -> ColoringPage:
        if output_format != "svg":
            raise ValueError("Only svg output is supported.")
        normalized, rng = create_rng(seed)
        lines, derived = pattern_lines(
            rng,
            mode,
            width_mm,
            height_mm,
            margin_mm,
            complexity,
            age_group,
            cell_size_mm,
            min_gap_mm,
            jitter,
            density,
            outer_frame,
        )
        lines = rounded_lines(lines)
        self.validate_plotter_safety(lines, width_mm, height_mm)
        metadata = self.add_metadata({
            "generator": "plotter-coloring-pages",
            "category": "coloring_pages",
            "function": "generate_math_pattern_coloring_page",
            "mode": mode,
            "seed": str(seed),
            "normalized_seed": normalized,
            "width_mm": width_mm,
            "height_mm": height_mm,
            "margin_mm": margin_mm,
            "stroke_width_mm": stroke_width_mm,
            "complexity": complexity,
            "age_group": age_group,
            "min_gap_mm": min_gap_mm,
            "jitter": jitter,
            "density": density,
            "closed_shapes_only": closed_shapes_only,
            "outer_frame": outer_frame,
            **derived,
        })
        svg = self.create_svg_canvas(width_mm, height_mm, lines, metadata, stroke_width_mm)
        return ColoringPage(svg, lines, width_mm, height_mm, metadata)


def generate_mandala_coloring_page(*args, **kwargs) -> str:
    return ColoringPageGenerator().generate_mandala_coloring_page(*args, **kwargs)


def generate_math_pattern_coloring_page(*args, **kwargs) -> str:
    return ColoringPageGenerator().generate_math_pattern_coloring_page(*args, **kwargs)


def generate_coloring_page(category: str, function: str, mode: str, seed: int | str, width_mm: float, height_mm: float, **params) -> str:
    if category != "coloring_pages":
        raise ValueError(f"Unsupported coloring page category: {category}")
    generator = ColoringPageGenerator()
    if function == "mandala":
        return generator.generate_mandala_coloring_page(seed, mode, width_mm, height_mm, **params)
    if function == "math_pattern":
        return generator.generate_math_pattern_coloring_page(seed, mode, width_mm, height_mm, **params)
    raise ValueError(f"Unsupported coloring page function: {function}")
