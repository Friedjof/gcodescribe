"""Backward-compatibility shim.

The OctoPrint client moved into the ``plotter.printer`` package when the
direct-serial backend was added. Import from there instead; this re-export
keeps older import paths working for one transition release.
"""

from __future__ import annotations

from .printer.octoprint import OctoPrintClient, OctoPrintError  # noqa: F401

__all__ = ["OctoPrintClient", "OctoPrintError"]
