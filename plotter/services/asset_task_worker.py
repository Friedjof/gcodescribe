"""Isolated conversion entry point. Never imports the web app or printer client."""

from __future__ import annotations

import json
import os
import shutil
import signal
import sys
from pathlib import Path

from plotter.artwork.xopp import select_xopp_page
from plotter.services.gallery import GalleryService


def write_json(path: Path, value: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value))
    os.replace(tmp, path)


def run(folder: Path) -> None:
    request = json.loads((folder / "request.json").read_text())
    staging = folder / "staging"
    shutil.rmtree(staging, ignore_errors=True)
    gallery = GalleryService(staging)
    write_json(folder / "progress.json", {"phase": "converting"})
    if request["kind"] == "import":
        source_bytes = (folder / "source").read_bytes()
        if request["filename"].lower().endswith(".xopp"):
            stem = Path(request["filename"]).stem
            items = []
            for number in request.get("selected_pages") or [1]:
                item = gallery.create(
                    f"{stem}-seite-{number}.xopp",
                    select_xopp_page(source_bytes, number),
                    title=f"{request.get('title') or stem} · Seite {number}",
                    uploader="admin", mode="auto", detail=request["detail"],
                )
                items.append(item)
        else:
            items = [gallery.create(
                request["filename"], source_bytes,
                title=request.get("title", ""), uploader="admin",
                mode=request["mode"], detail=request["detail"],
            )]
    else:
        item_id = request["item_id"]
        shutil.copytree(
            Path(request["gallery_root"]) / item_id,
            staging / item_id,
            ignore=shutil.ignore_patterns("generations"),
        )
        item = gallery.rerender(
            item_id,
            mode=request["mode"],
            detail=request["detail"],
            continuous=request.get("continuous", True),
        )
        items = [item]
    write_json(folder / "progress.json", {"phase": "preview"})
    for item in items:
        gallery.thumbnail(item["id"])
    item = items[0]
    preview = gallery.preview(item["id"], 1)
    result = {"item": item, "items": items}
    target = request.get("target")
    if target:
        if item["kind"] == "xopp":
            preview = gallery.original_strokes(item["id"], 1)
        lines = preview["polylines"]
        if not any(lines):
            raise ValueError("Das Bild enthält keine plottbaren Linien.")
        points = [p for line in lines for p in line]
        x0, y0 = min(p[0] for p in points), min(p[1] for p in points)
        x1, y1 = max(p[0] for p in points), max(p[1] for p in points)
        xopp = item["kind"] == "xopp"
        cx, cy = ((preview["width"] / 2, preview["height"] / 2) if xopp
                  else ((x0 + x1) / 2, (y0 + y1) / 2))
        local = [[[p[0] - cx, p[1] - cy] for p in line] for line in lines]
        # Keep the existing image-import anchor and fit semantics exactly.
        bounds = preview.get("bounds") or [0, 0, preview["width"], preview["height"]]
        width, height = ((preview["width"], preview["height"]) if xopp
                         else (bounds[2] - bounds[0], bounds[3] - bounds[1]))
        scale = min(
            1, target["width"] * 0.6 / max(width, 1), target["height"] * 0.6 / max(height, 1)
        )
        result["object"] = {
            "id": request["id"],
            "type": "image",
            "plotted": False,
            "data": {
                "galleryId": item["id"],
                "galleryPage": 1,
                "name": item["filename"],
                "mode": request["mode"],
                "detail": request["detail"],
                "width": preview["width"],
                "height": preview["height"],
                "basePolylines": local,
                **({"strokeOrder": "source", "sourcePage": {"width": width, "height": height},
                    "baseSegmentPressures": preview.get("segmentPressures"),
                    "cachedSegmentPressures": preview.get("segmentPressures"),
                    "pressureEnabled": False}
                   if xopp else {}),
            },
            "cachedPolylines": local,
            "transform": {
                "x": target["x"] + width * scale / 2,
                "y": target["y"] + height * scale / 2,
                "scale": scale,
                "rotation": 0,
            },
        }
    write_json(folder / "result.json", result)


if __name__ == "__main__":
    if sys.platform == "linux" and os.environ.get("PLOTTER_TASK_PARENT"):
        # If the API is killed, take converter grandchildren down as well.
        import ctypes

        signal.signal(signal.SIGTERM, lambda *_: os.killpg(os.getpgrp(), signal.SIGKILL))
        ctypes.CDLL(None).prctl(1, signal.SIGTERM)
        if os.getppid() != int(os.environ["PLOTTER_TASK_PARENT"]):
            os.killpg(os.getpgrp(), signal.SIGKILL)
    folder = Path(sys.argv[1])
    try:
        run(folder)
    except Exception as exc:
        write_json(folder / "error.json", {"error": str(exc)[:1000]})
        sys.exit(1)
