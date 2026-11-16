"""Compatibility API: immutable plot planning, G-code encoding and job persistence."""
from __future__ import annotations

import time
import uuid
from dataclasses import asdict
from pathlib import Path

from plotter.core.calibration import Calibration
from plotter.core.jobmeta import profile_comment, write_job_meta
from plotter.core.storage import jobs_dir
from plotter.gcode.pressure import page_uses_pressure
from plotter.plotplan import build_scene_plan, encode_plot_plan
from plotter.plotplan.source import (
    _ordered_lines as _ordered_lines,
)
from plotter.plotplan.source import (
    page_polylines as page_polylines,
)
from plotter.plotplan.source import (
    page_thumbnail as page_thumbnail,
)


def scene_gcode(page: dict, cal: Calibration) -> str:
    return encode_plot_plan(build_scene_plan(page, cal))


def save_scene_job(
    page: dict,
    cal: Calibration | None = None,
    profile: dict | None = None,
    *,
    filename_tag: str | None = None,
    source_kind: str = "paint_page",
    source_extra: dict | None = None,
) -> Path:
    """Write a G-code job for ``page`` into ``jobs_dir()`` and return its path."""
    cal = cal or Calibration.load()
    plan = build_scene_plan(page, cal)
    gcode = encode_plot_plan(plan)
    if profile is None:
        from plotter.services.profiles import ProfileService

        profile = ProfileService().active_profile_meta()
    raw_stem = str(page.get("name") or page.get("id") or "paint")
    stem = "".join(c if c.isalnum() or c in "-_" else "-" for c in raw_stem)
    tag = f"-{filename_tag}" if filename_tag else ""
    path = jobs_dir() / f"paint-{stem[:40]}{tag}-{int(time.time())}-{uuid.uuid4().hex[:8]}.gcode"
    path.write_text(profile_comment(profile) + gcode)
    source = {
        "kind": source_kind,
        "page_id": page.get("id"),
        "page_name": page.get("name"),
        "plot_plan_id": plan.plan_id,
        "plot_plan_version": plan.version,
    }
    if page.get("projectId"):
        source["project_id"] = page["projectId"]
    if source_extra:
        source.update(source_extra)
    if page_uses_pressure(page):
        source["pressure_enabled"] = True
    write_job_meta(
        path, source=source, profile=profile,
        calibration_snapshot={
            "profileId": profile["id"], "profileName": profile["name"],
            "fingerprint": profile["fingerprint"], "calibration": asdict(cal),
            "capturedAt": time.time(),
        } if page.get("projectId") else None,
    )
    return path
