# `plotter`

Python backend — G-code generation, calibration, job management, and the
HTTP API served to the frontend.

```
plotter/
│
│  ── Core geometry & scene ──────────────────────────────────────────────────
│
├── scene_geometry.py    Pure 2-D geometry helpers with no project dependencies.
│                        Type aliases: Point, Polyline, Polygon, EPS.
│                        Functions: transform_point, is_mask, mask_polygon,
│                        inside_convex, subtract_polygon_from_segment,
│                        subtract_polygon, apply_masks.
│                        Used exclusively by scene.py.
│
├── scene.py             Page → G-code pipeline. Imports from scene_geometry.
│                        Public API:
│                          page_polylines(page)   — extract unplotted strokes
│                          page_thumbnail(page)   — SVG path for sidebar thumb
│                          scene_gcode(page, cal) — full G-code string
│                          save_scene_job(page, cal, profile, …) → Path
│
│  ── Calibration & profiles ──────────────────────────────────────────────────
│
├── calibration.py       Calibration dataclass (origin, plot area, feeds, pen
│                        heights, obstacles, merge tolerance, …). Loads from
│                        and saves to the JSON config file.
│
│  ── G-code pipeline ────────────────────────────────────────────────────────
│
├── export.py            Low-level G-code helpers: calibration_comment,
│                        coordinate transforms for SVG sources
│
├── drawing.py           SVG/DXF → polylines, used by the file-convert pipeline
│
├── convert.py           High-level convert pipeline (SVG/DXF file → job)
│
├── pipeline.py          PlotterError exception, shared pipeline utilities
│
├── linemerge.py         Merge collinear/adjacent polylines to reduce pen lifts
│
├── routing.py           Dijkstra travel routing around obstacle zones
│
├── safety.py            GcodeSafetyChecker — validates generated G-code against
│                        bed limits and obstacle zones before it is written
│
├── singleline.py        Single-line font rendering (text → strokes)
│
├── trace.py             Bitmap → polylines (edge tracing)
│
│  ── State & storage ────────────────────────────────────────────────────────
│
├── state.py             Shared printer state (position, status, job progress)
│
├── storage.py           Path helpers: jobs_dir(), config_path(), …
│
├── jobmeta.py           Job sidecar (.meta.json) read/write
│
├── gcode_preview.py     G-code → preview polylines (for the 3-D viewer)
│
├── gcode_profile.py     Per-job profile snapshot written into G-code header
│
├── gallery_metrics.py   Compute GalleryScore/GalleryMetrics for uploaded SVGs
│
├── position.py          Printer position tracking and coordinate helpers
│
│  ── HTTP / device layer ────────────────────────────────────────────────────
│
├── document.py          FastAPI application factory and route registration
│
├── octoprint.py         OctoPrint REST client
│
├── config.py            App configuration (loaded from environment / file)
│
├── cli.py               CLI entry point (`python -m plotter`)
│
└── vpype_config.toml    vpype optimisation preset used during conversion
```

## Key invariants

- `scene_geometry.py` has **no project imports** — safe to unit-test in isolation.
- `scene.py` is the only file that imports `scene_geometry`.
- G-code is never written directly by route handlers; they always call
  `save_scene_job` or `convert`, which run `GcodeSafetyChecker` before saving.
