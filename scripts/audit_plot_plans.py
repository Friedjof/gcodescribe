"""Read-only regression audit of every stored slide in explicit file snapshots.

No DocumentStore/ProfileService calls, migrations, printer access or automatic
fitting. Sources may be file stores or read-only Redis exports with the same
state/paint_index.json + profiles layout. Reports omit names and raw geometry.
Run --help for the baseline/current workflow. Input directories are never written.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import statistics
import sys
import time
from collections import Counter
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORD = re.compile(r"([A-Z])(-?\d+(?:\.\d+)?)")


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode()).hexdigest()


def load_source(label: str, root: Path) -> tuple[list[dict], dict, dict[Path, str]]:
    """Read raw files, including archived projects and unindexed live slides."""
    hashes: dict[Path, str] = {}

    def read(path: Path) -> dict:
        raw = path.read_bytes()
        hashes[path] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)

    index = read(root / "state" / "paint_index.json")
    projects = {item["id"]: item for item in index.get("projects", [])}
    metadata = {item["id"]: item for item in index.get("order", [])}
    profiles = {}
    for path in sorted((root / "profiles").glob("*.json")):
        profile = read(path)
        if profile.get("id") and isinstance(profile.get("calibration"), dict):
            profiles[profile["id"]] = profile
    pages, tombstones, backups = {}, 0, 0
    for path in sorted((root / "state").glob("paint_page_*.json")):
        page = read(path)
        if path.stem.startswith("paint_page_before_projects_"):
            backups += 1
        elif not page.get("id"):
            tombstones += 1
        elif path.stem == f"paint_page_{page['id']}":
            pages[page["id"]] = page
        else:
            raise ValueError(f"Page ID does not match its file: {path.name}")
    ordered_ids = list(metadata) + sorted(set(pages) - set(metadata))
    cases = []
    for ordinal, page_id in enumerate(ordered_ids, 1):
        page = pages.get(page_id)
        project = projects.get((page or {}).get("projectId"))
        # Legacy stores bind pages directly. Never substitute the active profile.
        profile_id = project.get("profileId") if project else (page or {}).get("profileId")
        profile = profiles.get(profile_id)
        cases.append({
            "key": f"{label}/{ordinal:03d}", "source": label,
            "page": page, "profile": profile,
            "input_hash": digest({"page": page, "profile": profile}),
            "indexed": page_id in metadata,
            "project_archived": bool((project or {}).get("archived")),
            "profile_archived": bool((profile or {}).get("archived")),
            "missing_project": bool((page or {}).get("projectId")) and project is None,
        })
    inventory = {
        "source": label, "indexed_slides": len(metadata), "live_files": len(pages),
        "cases": len(cases), "projects": len(projects), "tombstones": tombstones,
        "migration_backups": backups, "unindexed_live_slides": len(set(pages) - set(metadata)),
        "missing_page_files": len(set(metadata) - set(pages)),
    }
    return cases, inventory, hashes


def unchanged(hashes: dict[Path, str]) -> bool:
    return all(path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected
               for path, expected in hashes.items())


def plotted_variants(cases: list[dict]) -> list[dict]:
    """Test already plotted content only in separate, visibly marked copies."""
    variants = []
    for case in cases:
        if not any(obj.get("plotted") for obj in (case["page"] or {}).get("objects", [])):
            continue
        variant = copy.deepcopy(case)
        variant["key"] += "/all-objects"
        variant["variant"] = "all_objects_on_copy"
        for obj in variant["page"]["objects"]:
            obj["plotted"] = False
        variant["input_hash"] = digest({"page": variant["page"], "profile": variant["profile"]})
        variants.append(variant)
    return variants


def gcode_facts(code: str) -> dict:
    """Measure emitted, rounded movements independently of the app time model."""
    xyz = (0.0, 0.0, 0.0)
    feed = 0.0
    motions, segments = [], Counter()
    travel, draw = 0.0, 0.0
    contacts = 0
    for raw in code.splitlines():
        line = raw.split(";", 1)[0].strip().upper()
        words = {key: float(value) for key, value in WORD.findall(line)}
        if words.get("G") not in (0, 1):
            continue
        feed = words.get("F", feed)
        end = tuple(words.get(axis, value) for axis, value in zip("XYZ", xyz, strict=True))
        motions.append((words["G"], *end, feed))
        if (words["G"] == 1 and "Z" in words and "X" not in words and "Y" not in words
                and end[2] < xyz[2]):
            contacts += 1
        if "X" in words or "Y" in words:
            if words["G"] == 1:
                segments[(*sorted((xyz, end)), feed)] += 1
                draw += math.dist(xyz, end)
            else:
                travel += math.dist(xyz[:2], end[:2])
        xyz = end
    canonical = [(key, count) for key, count in sorted(segments.items())]
    return {
        "motion_digest": digest(motions), "draw_segment_digest": digest(canonical),
        "draw_segment_count": sum(segments.values()), "draw_mm_exact": draw,
        "travel_mm_exact": travel, "pen_contacts": contacts,
    }


def protected_strokes(plan) -> tuple:
    return tuple((stroke.points, stroke.feeds, stroke.pressures, stroke.source_group)
                 for stroke in plan.strokes if stroke.order_locked)


def compare_plans(control, candidate, control_code: str, candidate_code: str) -> dict:
    before, after = gcode_facts(control_code), gcode_facts(candidate_code)
    failures = []
    if before["draw_segment_digest"] != after["draw_segment_digest"]:
        failures.append("drawn_segments_or_feeds_changed")
    if len(control.strokes) != len(candidate.strokes):
        failures.append("contact_count_changed")
    if before["pen_contacts"] != after["pen_contacts"]:
        failures.append("encoded_contact_count_changed")
    if protected_strokes(control) != protected_strokes(candidate):
        failures.append("protected_stroke_sequence_changed")
    delta = after["travel_mm_exact"] - before["travel_mm_exact"]
    if delta > 1e-6:
        failures.append("rounded_gcode_travel_regressed")
    return {
        "failures": failures,
        "draw_segments_preserved": before["draw_segment_digest"] == after["draw_segment_digest"],
        "protected_sequence_preserved": protected_strokes(control) == protected_strokes(candidate),
        "baseline": before, "optimized": after,
        "travel_saved_mm": -delta,
        "travel_saved_percent": (-100 * delta / before["travel_mm_exact"]
                                 if before["travel_mm_exact"] else 0.0),
    }


def summarize(reports: list[dict]) -> dict:
    """Separate ordinary slides from complete-copy variants to avoid double counting."""
    def group(cases: list[dict]) -> dict:
        valid = [case for case in cases if case.get("comparison")]
        if not valid:
            return {"cases": len(cases), "compared": 0}
        before = sum(case["comparison"]["baseline"]["travel_mm_exact"] for case in valid)
        after = sum(case["comparison"]["optimized"]["travel_mm_exact"] for case in valid)
        gains = [case["comparison"]["travel_saved_percent"] for case in valid]
        times = [case["optimize_and_encode_s"] for case in valid]
        cached_times = [case["cache_lookup_s"] for case in valid if "cache_lookup_s" in case]
        p95 = (statistics.quantiles(times, n=100, method="inclusive")[94]
               if len(times) > 1 else times[0])
        retraces = [case["report"]["continuous_extra_draw_mm"] for case in valid]
        return {
            "cases": len(cases), "compared": len(valid),
            "improved": sum(case["comparison"]["travel_saved_mm"] > 1e-6 for case in valid),
            "unchanged": sum(abs(case["comparison"]["travel_saved_mm"]) <= 1e-6 for case in valid),
            "worse": sum(case["comparison"]["travel_saved_mm"] < -1e-6 for case in valid),
            "baseline_travel_mm": before, "optimized_travel_mm": after,
            "saved_travel_mm": before - after,
            "weighted_saved_percent": 100 * (before - after) / before if before else 0.0,
            "median_slide_saved_percent": statistics.median(gains),
            "max_slide_saved_percent": max(gains),
            "candidate_plan_and_encode_s": {
                "median": statistics.median(times), "p95_inclusive": p95, "max": max(times),
                "scope": "Geometry preparation, optimization and encoding; host load varies",
            },
            "cache_reused_cases": sum(case.get("cache_reused", False) for case in valid),
            "cache_lookup_s": {
                "median": statistics.median(cached_times), "max": max(cached_times),
            } if cached_times else None,
            "protected_strokes": sum(case["report"]["protected_strokes"] for case in valid),
            "slides_with_existing_retraces": sum(
                case["report"]["continuous_extra_draw_mm"] > 1e-6 for case in valid
            ),
            "existing_retrace_mm": sum(retraces),
            "max_existing_retrace_mm": max(retraces),
            "all_contact_counts_preserved": all(
                not {"contact_count_changed", "encoded_contact_count_changed"}.intersection(
                    case["comparison"]["failures"]
                ) for case in valid
            ),
            "all_segment_multisets_preserved": all(
                case["comparison"]["draw_segments_preserved"] for case in valid
            ),
            "all_protected_sequences_preserved": all(
                case["comparison"]["protected_sequence_preserved"] for case in valid
            ),
        }
    return {
        "ordinary_slides": group([case for case in reports if not case.get("variant")]),
        "complete_copy_variants": group([case for case in reports if case.get("variant")]),
        "per_source_ordinary": {
            source: group([case for case in reports
                           if case["source"] == source and not case.get("variant")])
            for source in sorted({case["source"] for case in reports})
        },
    }


def audit_case(case: dict, *, legacy: bool = False, baseline: dict | None = None) -> dict:
    # Imported lazily so baseline runs can select a frozen package first.
    from plotter.core.calibration import Calibration
    from plotter.gcode.metrics import analyze_gcode, metrics_dict

    page, profile = case["page"], case["profile"]
    result = {key: value for key, value in case.items() if key not in ("page", "profile")}
    objects = (page or {}).get("objects", [])
    result.update({
        "objects": len(objects), "plotted_objects": sum(bool(o.get("plotted")) for o in objects),
        "input_points": sum(len(line) for obj in objects
                            for line in obj.get("cachedPolylines", [])),
        "object_types": dict(Counter(obj.get("type", "unknown") for obj in objects)),
    })
    if page is None or profile is None or case["missing_project"]:
        result.update(status="missing_context", reason="page, project or profile missing")
        return result
    if not objects or all(obj.get("plotted") for obj in objects):
        result["status"] = "empty" if not objects else "fully_plotted"
        return result
    start = time.perf_counter()
    input_hash = digest({"page": page, "profile": profile})
    try:
        calibration = Calibration.from_stored_dict(profile["calibration"])
        if legacy:
            from plotter.gcode.scene import scene_gcode
            code = scene_gcode(page, calibration)
            result.update(status="ok", facts=gcode_facts(code),
                          metrics=metrics_dict(analyze_gcode(code)))
        else:
            from plotter.plotplan import (
                build_scene_plan,
                clear_plot_plan_cache,
                encode_plot_plan,
            )
            control = build_scene_plan(page, calibration, optimize=False)
            control_code = encode_plot_plan(control)
            planned_at = time.perf_counter()
            candidate = build_scene_plan(page, calibration, optimize=True)
            candidate_code = encode_plot_plan(candidate)
            compared = compare_plans(control, candidate, control_code, candidate_code)
            result.update(
                status="regression" if compared["failures"] else "ok",
                comparison=compared, report=asdict(candidate.report),
                baseline_plan_id=control.plan_id, plan_id=candidate.plan_id,
                optimize_and_encode_s=time.perf_counter() - planned_at,
                metrics=metrics_dict(analyze_gcode(candidate_code)),
            )
            clear_plot_plan_cache()
            repeated = build_scene_plan(page, calibration, optimize=True)
            if (repeated.plan_id != candidate.plan_id
                    or encode_plot_plan(repeated) != candidate_code):
                compared["failures"].append("nondeterministic_plan_or_gcode")
                result["status"] = "regression"
            cached_at = time.perf_counter()
            cached = build_scene_plan(page, calibration, optimize=True)
            result["cache_lookup_s"] = time.perf_counter() - cached_at
            result["cache_reused"] = cached is repeated
            if cached.plan_id != candidate.plan_id:
                compared["failures"].append("cache_plan_identity_changed")
                result["status"] = "regression"
            if baseline is not None:
                if baseline.get("input_hash") != input_hash:
                    compared["failures"].append("legacy_baseline_input_mismatch")
                    result["status"] = "regression"
                elif baseline.get("status") == "ok":
                    same = (baseline["facts"]["motion_digest"]
                            == compared["baseline"]["motion_digest"])
                    result["legacy_identity_motion_equal"] = same
                    if not same:
                        compared["failures"].append("legacy_identity_motion_changed")
                        result["status"] = "regression"
                else:
                    result["legacy_status"] = baseline.get("status")
    except Exception as exc:  # Audit must account for every slide, even malformed ones.
        reason = str(exc)
        for private in (page.get("name"), page.get("id")):
            if private:
                reason = reason.replace(private, "[slide]")
        result.update(status="rejected", error_type=type(exc).__name__, reason=reason)
        if baseline and baseline.get("status") == "ok":
            result["status"] = "regression"
            result["failures"] = ["previously_valid_slide_rejected"]
    if digest({"page": page, "profile": profile}) != input_hash:
        result["status"] = "regression"
        result.setdefault("failures", []).append("input_mutated")
    result["elapsed_s"] = time.perf_counter() - start
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="append", required=True, metavar="LABEL=DATA_DIR")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline-package", type=Path,
                        help="Use a frozen legacy package, e.g. /tmp/old-renderer")
    parser.add_argument("--baseline", type=Path, help="Baseline JSON from the same input snapshot")
    variants = parser.add_mutually_exclusive_group()
    variants.add_argument("--include-plotted", action="store_true",
                          help="Also render complete copies of slides with plotted objects")
    variants.add_argument("--plotted-variants-only", action="store_true",
                          help="Only render complete copies of slides with plotted objects")
    args = parser.parse_args()
    sys.path.insert(0, str(args.baseline_package or ROOT))
    sources, hashes, cases = [], {}, []
    labels = set()
    for item in args.source:
        label, directory = item.split("=", 1)
        if not label or label in labels:
            parser.error("Source labels must be non-empty and unique")
        labels.add(label)
        if args.output.resolve().is_relative_to(Path(directory).resolve()):
            parser.error("Output must be outside the read-only input directories")
        loaded, inventory, files = load_source(label, Path(directory))
        sources.append(inventory)
        cases.extend(loaded)
        hashes.update(files)
    if args.plotted_variants_only:
        cases = plotted_variants(cases)
    elif args.include_plotted:
        cases += plotted_variants(cases)
    previous = {}
    if args.baseline:
        baseline_report = json.loads(args.baseline.read_text())
        if not baseline_report.get("complete") or not baseline_report.get("inputs_unchanged"):
            parser.error("Baseline must be complete and its input files must be unchanged")
        previous = {case["key"]: case for case in baseline_report["cases"]}
    coverage = not args.baseline or set(previous) == {case["key"] for case in cases}
    reports = []

    def write_report(complete: bool) -> None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        report = {
            "scope": ("Complete-copy variants of slides with plotted objects"
                      if args.plotted_variants_only else "All stored slides in explicit snapshots"),
            "no_fitting_or_source_mutations": True,
            "complete": complete, "sources": sources, "cases": reports,
            "status_counts": dict(Counter(item["status"] for item in reports)),
            "inputs_unchanged": unchanged(hashes) if complete else None,
            "baseline_coverage_matches": coverage,
            "summary": summarize(reports) if complete else None,
        }
        args.output.write_text(json.dumps(report, indent=2) + "\n")

    write_report(not cases)
    for number, case in enumerate(cases, 1):
        result = audit_case(case, legacy=bool(args.baseline_package),
                            baseline=previous.get(case["key"]))
        reports.append(result)
        print(f"{number}/{len(cases)} {case['key']}: {result['status']}", flush=True)
        # Persist progress so an interrupted audit never looks complete.
        write_report(number == len(cases))
    return int(not coverage or not unchanged(hashes)
               or any(item["status"] not in {"ok", "empty", "fully_plotted"} for item in reports))


if __name__ == "__main__":
    raise SystemExit(main())
