from __future__ import annotations

import tempfile
from pathlib import Path

from .calibration import Calibration
from .export import calibration_comment
from .gcode_profile import build_vpype_config, layout_operations
from .pipeline import PipelineResult, process_file
from .safety import GcodeSafetyChecker, SafetyViolation


def convert_with_calibration(
    source: Path,
    output_dir: Path,
    cal: Calibration,
    *,
    pages: list[int] | None = None,
) -> PipelineResult:
    """Convert a document to G-code using the given calibration.

    Generates a vpype config on the fly from ``cal`` and writes the resulting
    G-code file(s) into ``output_dir``.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    profile = "plotter"
    config_text = build_vpype_config(cal, profile)
    ops = layout_operations(cal)

    with tempfile.NamedTemporaryFile(
        "w", suffix=".toml", prefix="plotter-cfg-", delete=False
    ) as tmp:
        tmp.write(config_text)
        config_path = Path(tmp.name)

    try:
        # Force directory output so multi-page docs land predictably.
        result = process_file(
            source,
            output_dir,
            pages=pages,
            profile=profile,
            config_path=config_path,
            layout_ops=ops,
        )
    finally:
        config_path.unlink(missing_ok=True)

    # Safety gate: every generated job must stay within the calibrated bounds.
    # A violating file is removed so it can never be sent to the printer.
    checker = GcodeSafetyChecker(cal)
    header = calibration_comment(cal)
    for path in result.gcode_files:
        text = path.read_text()
        try:
            checker.check(text, name=path.name)
        except SafetyViolation:
            for p in result.gcode_files:
                p.unlink(missing_ok=True)
            raise
        path.write_text(header + text)
    return result
