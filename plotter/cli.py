from __future__ import annotations

import argparse
from pathlib import Path

from .pipeline import PlotterError, process_file


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="plotter",
        description="Convert SVG/PDF/LibreOffice documents to plotter G-code.",
    )
    parser.add_argument("input", type=Path, help="Input SVG, PDF, or LibreOffice document")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output file or directory. Defaults to <input>.gcode or <input>-pages/",
    )
    parser.add_argument(
        "-p",
        "--page",
        dest="pages",
        action="append",
        type=int,
        help="PDF page to process (can be repeated). Defaults to all pages.",
    )
    parser.add_argument(
        "--profile",
        default="anycubic",
        help="vpype gwrite profile name from the project config",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).with_name("vpype_config.toml"),
        help="Additional vpype config file to load",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    source = args.input
    if not source.exists():
        parser.error(f"input file does not exist: {source}")

    if args.pages is not None:
        pages = sorted(set(args.pages))
        if any(page < 1 for page in pages):
            parser.error("page numbers must be positive")
    else:
        pages = None

    try:
        result = process_file(
            source,
            args.output,
            pages=pages,
            profile=args.profile,
            config_path=args.config,
        )
    except PlotterError as exc:
        parser.exit(1, f"error: {exc}\n")

    if len(result.gcode_files) == 1:
        print(result.gcode_files[0])
    else:
        for path in result.gcode_files:
            print(path)
    return 0

