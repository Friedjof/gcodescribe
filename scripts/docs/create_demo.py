"""Create public documentation fixtures in a NEW, isolated application data directory.

This does not connect to printers or read an existing user's application data.
The editable Workshop font and the drawings are original synthetic demo artwork.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path


def seed(data_dir: Path, export_dir: Path) -> dict:
    if data_dir.exists() and any(data_dir.iterdir()):
        raise SystemExit(
            "Use an empty data directory; existing application data is never overwritten."
        )
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ.update(
        PLOTTER_DATA_DIR=str(data_dir.resolve()),
        STATE_STORE="file",
        REDIS_URL="",
        PRINTER_SERIAL_ENABLED="false",
        OCTOPRINT_URL="",
        OCTOPRINT_API_KEY="",
    )
    from fontTools.pens.recordingPen import RecordingPen
    from fontTools.svgLib.path import parse_path

    from plotter.core.calibration import Calibration
    from plotter.core.document import DocumentStore
    from plotter.core.state import FileStateStore
    from plotter.services.profiles import ProfileService
    from plotter.services.stroke_fonts import StrokeFontService
    from plotter.text.flatten import recording_to_strokes

    # Original monoline glyphs, coordinates in em units with baseline at y=0.
    paths = {
        "a": (
            "M370 400 C220 530 60 340 100 130 C140 -80 350 -10 390 230 L420 460 "
            "L380 60 Q390 -25 500 30"
        ),
        "b": "M80 0 L150 740 L100 140 C130 -60 420 -30 440 240 C460 500 190 520 110 180 L480 10",
        "c": "M410 380 C250 570 40 330 100 100 Q180 -90 460 60",
        "d": (
            "M370 400 C220 520 60 330 100 120 C160 -110 370 20 400 270 L440 740 "
            "L390 50 Q420 -35 520 30"
        ),
        "e": "M100 210 Q480 240 350 410 C180 580 10 210 120 50 Q240 -75 460 70",
        "f": "M80 -220 Q170 280 230 610 Q300 820 420 690 M50 380 L430 400",
        "g": (
            "M370 410 C160 560 10 250 140 60 Q330 -70 400 230 L430 460 L370 -130 Q290 -350 100 -180"
        ),
        "h": "M70 0 L140 740 L90 80 Q200 520 350 420 Q400 370 350 30 Q400 -35 500 40",
        "i": "M130 430 L100 70 Q130 -30 330 35 M160 620 L165 625",
        "j": "M230 440 L180 -150 Q100 -340 10 -210 M260 630 L265 635",
        "k": "M80 0 L150 740 M110 160 L420 460 M230 280 Q260 -25 500 30",
        "l": "M130 0 Q140 400 190 650 C290 910 420 600 170 300 Q50 0 370 40",
        "m": (
            "M80 0 L130 440 L90 90 Q190 520 310 420 L270 20 Q400 510 510 410 L480 "
            "40 Q510 -20 610 30"
        ),
        "n": "M80 0 L130 440 L90 90 Q260 560 380 390 L340 40 Q380 -35 490 40",
        "o": "M350 430 C110 590 -10 140 160 20 C390 -150 540 460 300 450 Q220 420 460 300",
        "p": "M80 -220 L160 440 L130 140 Q200 -90 420 80 C620 400 300 650 150 260",
        "q": "M360 430 C120 560 -10 180 140 40 Q350 -50 400 260 L430 460 L360 -210 L530 -110",
        "r": "M80 0 L140 440 L100 130 Q210 560 400 380",
        "s": "M400 390 Q230 590 130 350 C60 170 480 250 380 60 Q240 -110 70 60",
        "t": "M180 660 L130 70 Q180 -50 430 40 M40 410 L420 440",
        "u": "M100 450 L60 100 Q80 -100 330 80 L400 460 L360 60 Q400 -30 500 40",
        "v": "M80 440 Q80 -40 230 20 Q370 60 440 470",
        "w": "M60 450 Q60 -70 220 30 L300 430 Q290 -60 460 30 Q570 100 620 470",
        "x": "M80 420 Q160 480 270 210 Q370 -40 490 30 M430 460 L80 0",
        "y": "M90 450 L60 100 Q90 -90 330 80 L410 460 L340 -130 Q250 -350 80 -180",
        "z": "M80 400 Q240 500 430 430 L70 20 Q270 -60 480 50",
        "A": "M40 0 Q150 280 310 710 Q380 390 490 0 M140 270 Q300 310 430 270",
        "B": "M90 0 L150 700 C560 790 610 340 140 360 C660 470 640 -100 90 0",
        "C": "M510 590 C300 880 20 580 70 240 Q100 -100 510 70",
        "D": "M90 0 L140 700 C710 800 720 -70 90 0",
        "E": "M510 700 L150 700 L90 0 L500 25 M130 370 L430 390",
        "F": "M100 0 L150 700 L530 720 M130 380 L430 400",
        "G": "M530 600 C250 900 10 520 90 200 Q210 -100 530 100 L540 330 L330 320",
        "H": "M90 0 L150 700 M510 0 L560 700 M120 340 L540 370",
        "I": "M110 700 L440 720 M280 710 L230 0 M60 0 L400 20",
        "J": "M100 700 L510 720 L460 180 Q380 -150 90 50",
        "K": "M100 0 L150 700 M140 280 L550 710 M300 440 L540 0",
        "L": "M150 700 L100 0 Q300 40 530 10",
        "M": "M60 0 L130 700 L330 200 L560 720 L570 0",
        "N": "M80 0 L140 700 L500 20 L550 720",
        "O": "M340 710 C-30 780 -30 -70 300 0 C650 0 690 770 340 710",
        "P": "M90 0 L150 700 C700 850 640 260 130 340",
        "Q": "M340 710 C-30 780 -30 -70 300 0 C650 0 690 770 340 710 M330 160 L610 -110",
        "R": "M90 0 L150 700 C700 850 640 260 130 340 M310 350 L550 0",
        "S": "M530 600 C130 920 -10 390 290 350 C720 300 530 -150 70 60",
        "T": "M30 690 Q340 740 620 720 M340 720 L280 0",
        "U": "M140 710 L100 180 C80 -100 500 -100 530 200 L570 720",
        "V": "M80 710 L260 0 L590 720",
        "W": "M50 710 L170 0 L360 570 L460 0 L700 720",
        "X": "M80 700 L550 0 M570 720 L60 0",
        "Y": "M80 710 L310 340 L590 720 M310 340 L260 0",
        "Z": "M90 690 L550 720 L50 0 L530 30",
        "0": "M300 650 C30 700 0 -40 270 0 C560 0 590 700 300 650",
        "1": "M90 490 L280 660 L230 0 M80 0 L390 20",
        "2": "M80 510 C230 840 650 520 370 310 L80 0 L510 20",
        "3": "M90 560 C300 790 600 530 300 350 C650 350 550 -130 70 60",
        "4": "M420 660 L60 220 L550 240 M430 660 L380 0",
        "5": "M520 670 L150 650 L110 350 C610 560 650 -130 80 50",
        "6": "M470 650 C150 730 -30 90 180 20 C520 -160 660 470 110 250",
        "7": "M70 650 L550 680 L200 0 M130 330 L460 350",
        "8": "M300 350 C-50 510 180 850 450 620 C650 350 -30 300 120 50 C390 -190 720 170 300 350",
        "9": "M460 420 C440 800 -30 700 100 390 Q180 210 470 390 Q410 -20 110 0",
        ".": "M150 10 L155 15",
        ",": "M180 30 L110 -100",
        "!": "M180 680 L140 160 M140 20 L145 25",
        "?": "M60 530 C240 820 550 540 300 340 L250 160 M230 10 L235 15",
        ":": "M160 350 L165 355 M140 20 L145 25",
        "-": "M60 250 L400 270",
        "/": "M50 -60 L440 740",
        "+": "M60 260 L460 280 M280 40 L300 520",
        "(": "M300 730 Q0 330 250 -100",
        ")": "M90 730 Q380 330 50 -100",
    }
    for base, accent in [("a", "ä"), ("o", "ö"), ("u", "ü"), ("A", "Ä"), ("O", "Ö"), ("U", "Ü")]:
        height = 620 if base.islower() else 850
        paths[accent] = (
            paths[base] + f" M170 {height} L175 {height + 5} M370 {height} L375 {height + 5}"
        )
    paths["ß"] = "M80 0 L130 490 C160 850 590 630 330 380 C650 270 480 -50 240 40"
    fonts = StrokeFontService()
    font = fonts.create("Workshop – Demo")
    glyphs = []
    for key, path in paths.items():
        pen = RecordingPen()
        parse_path(path, pen)
        lines = recording_to_strokes(pen.value)
        variants = []
        for variant in range(3):
            strokes = []
            for n, line in enumerate(lines):
                pts = [
                    {
                        "x": round(x + (0.03 + variant * 0.018) * y, 2),
                        "y": round(y * (1 + variant * 0.008), 2),
                    }
                    for x, y in line
                ]
                strokes.append(
                    {"id": f"s-{ord(key)}-{variant}-{n}", "rawPoints": pts, "points": pts}
                )
            width = max((pt["x"] for stroke in strokes for pt in stroke["points"]), default=350)
            variants.append(
                {
                    "id": f"v-{ord(key)}-{variant}",
                    "weight": 1,
                    "strokes": strokes,
                    "advance": max(350, width + 85),
                }
            )
        glyphs.append(
            {"key": key, "type": "character", "label": key, "variants": variants, "tags": []}
        )
    font = fonts.save(font["id"], {**font, "glyphs": glyphs})
    export_dir.mkdir(parents=True, exist_ok=True)
    (export_dir / "workshop-demo.gcsfont").write_text(
        json.dumps(fonts.export(font["id"]), ensure_ascii=False, indent=2)
    )
    cal = Calibration(
        bed_width=230,
        bed_height=230,
        origin_x=15,
        origin_y=45,
        plot_width=200,
        plot_height=140,
        paper_corners={"bl": [10, 40], "br": [220, 40], "tr": [220, 190], "tl": [10, 190]},
        paper_margin=5,
        pen_down_z=1.4,
        pen_up_z=7.4,
        pen_calibrated=True,
        calibration_x=20,
        calibration_y=20,
        park_x=220,
        park_y=220,
    )
    cal.save()
    profiles = ProfileService()
    profile = profiles.update(
        profiles.active_id(), name="Demo plotter profile", calibration=cal.as_dict()
    )
    docs = DocumentStore(FileStateStore(data_dir / "state"))
    index = docs.list_pages()
    docs.update_project(index["project"]["id"], name="Plotter Workshop")

    def obj(name, lines, x=0, y=0):
        return {
            "id": name,
            "type": "pen",
            "data": {"name": name},
            "transform": {"x": x, "y": y, "scale": 1, "rotation": 0},
            "cachedPolylines": lines,
        }

    def line(x0, y0, x1, y1):
        return [[x0, y0], [x1, y1]]

    def circle(cx, cy, r):
        return [
            [cx + r * math.cos(i * math.tau / 100), cy + r * math.sin(i * math.tau / 100)]
            for i in range(101)
        ]

    def text(value, size, x, y):
        return obj(value, fonts.render(font["id"], value, size, seed=19).polylines, x, y)

    botanical = []
    for stem in range(3):
        sx = 45 + stem * 45
        botanical.append(
            [[sx + math.sin(t * 3) * 9, 112 - t * 75] for t in [i / 80 for i in range(81)]]
        )
        for level in range(5):
            yy = 98 - level * 13
            xx = sx + math.sin((112 - yy) / 75 * 3) * 9
            side = 1 if level % 2 else -1
            for j in range(5):
                botanical.append(
                    [
                        [xx + side * 27 * t, yy - 19 * t + math.sin(math.pi * t) * (7 - j * 1.5)]
                        for t in [i / 40 for i in range(41)]
                    ]
                )
    botanical_objects = [
        text("Botanical lines", 11, 30, 4),
        obj("Leaf studies", botanical),
        text("Three branches. One pen.", 6, 40, 119),
    ]
    rose = [
        [
            100 + (45 + 14 * math.cos(7 * t)) * math.cos(t),
            72 + (45 + 14 * math.cos(7 * t)) * math.sin(t),
        ]
        for t in [i * math.tau / 1600 for i in range(1601)]
    ]
    geometry = [
        text("Line art", 12, 55, 2),
        obj("Rosette", [rose]),
        text("Precision meets paper", 7, 37, 122),
    ]
    overview = [text("Ideas become lines", 12, 20, 1)]
    for cx, cy in [(48, 68), (100, 68), (152, 68)]:
        curves = []
        if cx == 48:
            curves = [
                [
                    [
                        cx + (19 + 5 * math.cos(6 * t)) * math.cos(t),
                        cy + (19 + 5 * math.cos(6 * t)) * math.sin(t),
                    ]
                    for t in [i * math.tau / 500 for i in range(501)]
                ]
            ]
        elif cx == 100:
            curves = [
                [
                    [
                        cx - 20 + t * 40,
                        cy - 15 + j * 3 + math.sin(t * math.tau * 1.5 + j * 0.25) * 5,
                    ]
                    for t in [i / 80 for i in range(81)]
                ]
                for j in range(10)
            ]
        else:
            curves = [circle(cx, cy, r) for r in [7, 12, 17, 22]] + [
                line(cx - 25, cy, cx + 25, cy),
                line(cx, cy - 25, cx, cy + 25),
            ]
        overview.append(obj(f"Study {cx}", curves))
    overview += [
        text("Shape", 7, 38, 101),
        text("Rhythm", 7, 83, 101),
        text("Geometry", 7, 132, 101),
        text("A workshop for pen and paper", 6, 38, 122),
    ]
    streets = []
    for i in range(13):
        streets.append(
            [[20 + j * 1.9, 22 + i * 6 + math.sin(j * 0.13 + i * 0.8) * 3] for j in range(81)]
        )
    for j in range(17):
        streets.append([[25 + j * 9 + math.sin(i * 0.11 + j) * 5, 20 + i * 1.1] for i in range(81)])
    map_objects = [
        text("City map - Demo", 10, 45, 0),
        obj("Imaginary streets", streets),
        text("An imaginary city drawn in lines", 6, 38, 122),
    ]

    # Restore real colour assignments through the public scene model.
    def colouring(objects):
        assignments = {}

        def base36(value):
            digits = "0123456789abcdefghijklmnopqrstuvwxyz"
            result = ""
            while value:
                value, remainder = divmod(value, 36)
                result = digits[remainder] + result
            return result or "0"

        for obj_index, item in enumerate(objects):
            tx, ty = item["transform"]["x"], item["transform"]["y"]
            for raw in item["cachedPolylines"]:
                if len(raw) < 2:
                    continue
                world = [[x + tx, y + ty] for x, y in raw]
                dense = [world[0]]
                for a, b in zip(world, world[1:], strict=False):
                    steps = min(400, max(1, math.ceil(math.dist(a, b) / 2.5)))
                    dense += [
                        [a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps]
                        for i in range(1, steps + 1)
                    ]
                hashed = 2166136261
                for point in dense:
                    for value in point:
                        hashed = (
                            (hashed ^ (math.floor(value * 10 + 0.5) & 0xFFFFFFFF)) * 16777619
                        ) & 0xFFFFFFFF
                x = sum(p[0] for p in dense) / len(dense)
                colour = (
                    "black"
                    if obj_index != 1
                    else ("green" if x < 75 else "blue" if x < 125 else "red")
                )
                assignments[f"{len(dense)}_{base36(hashed)}"] = [colour] * (len(dense) - 1)
        return {"assignments": assignments, "order": ["black", "green", "blue", "red"]}

    pages = {}
    for name, objects in [
        ("Workshop", overview),
        ("Botanical", botanical_objects),
        ("Line art", geometry),
        ("City map", map_objects),
    ]:
        page = docs.create_page(name)
        docs.save_page(
            page["id"], {"objects": objects, "continuous": False, "coloring": colouring(objects)}
        )
        pages[name] = page["id"]
    first = index["activeId"]
    docs.delete_page(first)
    docs.set_active(pages["Workshop"])
    manifest = {"fontId": font["id"], "profileId": profile["id"], "pages": pages}
    (data_dir / "demo-manifest.json").write_text(json.dumps(manifest))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--export-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(seed(args.data_dir, args.export_dir)))


if __name__ == "__main__":
    main()
