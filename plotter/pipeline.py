from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


class PlotterError(RuntimeError):
    pass


SVG_EXTENSIONS = {".svg"}
PDF_EXTENSIONS = {".pdf"}
OFFICE_EXTENSIONS = {
    ".odt",
    ".ods",
    ".odp",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
}


@dataclass(frozen=True)
class PipelineResult:
    source: Path
    svg_files: list[Path]
    gcode_files: list[Path]


def ensure_command(command: str) -> str:
    resolved = shutil.which(command)
    if resolved:
        return resolved
    raise PlotterError(f"Required command not found on PATH: {command}")


def run_command(command: list[str], *, cwd: Path | None = None) -> None:
    try:
        subprocess.run(command, cwd=cwd, check=True, text=True, capture_output=True)
    except FileNotFoundError as exc:
        raise PlotterError(f"Required command not found: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() if exc.stderr else ""
        stdout = exc.stdout.strip() if exc.stdout else ""
        message = stderr or stdout or f"command failed with exit code {exc.returncode}"
        raise PlotterError(f"{command[0]} failed: {message}") from exc


def detect_kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in SVG_EXTENSIONS:
        return "svg"
    if suffix in PDF_EXTENSIONS:
        return "pdf"
    if suffix in OFFICE_EXTENSIONS:
        return "office"
    raise PlotterError(f"Unsupported input format: {path.suffix}")


def convert_office_to_pdf(source: Path, workdir: Path) -> Path:
    soffice = ensure_command("soffice")
    run_command(
        [
            soffice,
            "--headless",
            "--nologo",
            "--nolockcheck",
            "--nodefault",
            "--convert-to",
            "pdf",
            "--outdir",
            str(workdir),
            str(source),
        ]
    )
    pdf_path = workdir / f"{source.stem}.pdf"
    if not pdf_path.exists():
        raise PlotterError(f"LibreOffice did not produce PDF output for {source}")
    return pdf_path


def pdf_page_count(source: Path) -> int:
    pdfinfo = ensure_command("pdfinfo")
    try:
        result = subprocess.run(
            [pdfinfo, str(source)], check=True, text=True, capture_output=True
        )
    except subprocess.CalledProcessError as exc:
        raise PlotterError(f"pdfinfo failed: {exc.stderr or exc.stdout}") from exc
    for line in result.stdout.splitlines():
        if line.lower().startswith("pages:"):
            return int(line.split(":", 1)[1])
    raise PlotterError(f"could not determine page count of {source}")


def convert_pdf_to_svg_files(source: Path, workdir: Path, pages: list[int] | None) -> list[Path]:
    # pdftocairo -svg writes to the *exact* output filename given (it does not
    # append .svg to a prefix like the raster modes do) — pass explicit files.
    pdftocairo = ensure_command("pdftocairo")
    page_numbers = pages or list(range(1, pdf_page_count(source) + 1))
    svg_files: list[Path] = []
    for page in page_numbers:
        out = workdir / f"{source.stem}-page-{page:04d}.svg"
        run_command(
            [pdftocairo, "-svg", "-f", str(page), "-l", str(page), str(source), str(out)]
        )
        if not out.exists():
            raise PlotterError(f"pdftocairo did not produce SVG output for page {page}")
        svg_files.append(out)
    return svg_files


def run_vpype(
    svg_path: Path,
    gcode_path: Path,
    config_path: Path,
    profile: str,
    layout_ops: list[str] | None = None,
) -> None:
    vpype = ensure_command("vpype")
    command = [vpype, "-c", str(config_path), "read", str(svg_path)]
    command += ["linesimplify", "linemerge", "linesort"]
    command += list(layout_ops or [])
    command += ["gwrite", "--profile", profile, str(gcode_path)]
    run_command(command)


def process_file(
    source: Path,
    output: Path | None,
    *,
    pages: list[int] | None,
    profile: str,
    config_path: Path,
    layout_ops: list[str] | None = None,
) -> PipelineResult:
    source = source.resolve()
    kind = detect_kind(source)

    output_files: list[Path] = []
    svg_files: list[Path]

    import tempfile

    with tempfile.TemporaryDirectory(prefix="plotter-") as tmp:
        workdir = Path(tmp)
        if kind == "svg":
            svg_files = [source]
        else:
            pdf_source = source if kind == "pdf" else convert_office_to_pdf(source, workdir)
            svg_files = convert_pdf_to_svg_files(pdf_source, workdir, pages)

        if output is None:
            if len(svg_files) == 1:
                output_path = source.with_suffix(".gcode")
            else:
                output_path = source.with_name(f"{source.stem}-pages")
        else:
            output_path = output.resolve()

        if len(svg_files) == 1 and output_path.suffix:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            run_vpype(svg_files[0], output_path, config_path, profile, layout_ops)
            output_files.append(output_path)
        else:
            output_path.mkdir(parents=True, exist_ok=True)
            for svg_file in svg_files:
                gcode_name = f"{svg_file.stem}.gcode"
                gcode_path = output_path / gcode_name
                run_vpype(svg_file, gcode_path, config_path, profile, layout_ops)
                output_files.append(gcode_path)

    return PipelineResult(source=source, svg_files=[], gcode_files=output_files)
