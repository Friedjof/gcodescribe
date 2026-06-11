from __future__ import annotations

from pathlib import Path

from .calibration import data_dir


def jobs_dir() -> Path:
    """Directory for generated G-code jobs."""
    path = data_dir() / "jobs"
    path.mkdir(parents=True, exist_ok=True)
    return path
