from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Literal, TypedDict


class PlotAreaBase(TypedDict):
    x: float
    y: float
    w: float
    h: float

PositionKind = Literal["park", "calibration"]
POSITION_FIELDS: dict[PositionKind, tuple[str, str]] = {
    "park": ("park_x", "park_y"),
    "calibration": ("calibration_x", "calibration_y"),
}


def data_dir() -> Path:
    """Directory for persisted state (calibration, generated jobs)."""
    path = Path(os.environ.get("PLOTTER_DATA_DIR", "data"))
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class Calibration:
    """Plotter calibration. All distances in mm, feedrates in mm/s.

    G-code's F-word is mm/min by convention, so any Z/X/Y move built from a
    feed field here must go through ``feed_word()`` to convert.
    """

    # Physical travel limits.
    bed_width: float = 210.0
    bed_height: float = 210.0
    z_max: float = 205.0

    # Usable plot area and its origin offset on the bed.
    plot_width: float = 200.0
    plot_height: float = 200.0
    origin_x: float = 5.0
    origin_y: float = 5.0
    # The general plot rectangle before the margin is applied. Legacy data
    # reconstructs it from the effective area plus its previous margin.
    plot_area_base: PlotAreaBase | None = None

    # Pen mechanism (absolute Z heights).
    pen_up_z: float = 5.0
    pen_down_z: float = 0.0
    # Optional Xournal pressure: maximum additional downward travel from the
    # calibrated pen-down height. Zero keeps all plots at the fixed height.
    pen_pressure_max_depth: float = 0.0
    # True once the pen-down height was captured from the head position via
    # the wizard. Persisted, so the "pen height set" state survives tab
    # switches and app restarts.
    pen_calibrated: bool = False

    # Feedrates, all mm/s.
    travel_feed: float = 100.0
    draw_feed: float = 50.0
    z_feed: float = 26.7
    # Firmware max Z feedrate (M203). Most printers' stock firmware caps Z far
    # below what the hardware can actually do (e.g. 6 mm/s on the Anycubic i3
    # Mega S), which silently clamps z_feed. M203 is RAM-only, so it has to be
    # resent before every Z move rather than set once.
    z_max_feedrate: float = 60.0

    # Layout behaviour.
    fit_to_area: bool = True  # scale the drawing to fit plot_width x plot_height
    flip_y: bool = True  # SVG y-axis points down; printer y-axis points up
    trust_axis_home: bool = False  # true if the firmware honours G28 axis arguments
    park_after_plot: bool = True  # move to the park position after the job finishes

    # Where the pen parks after a job finishes (or on pause/cancel), and how
    # high it lifts before travelling there. Stay ``None`` (== "not yet
    # customised") until the user drags the park marker / edits the lift
    # field — that keeps them tracking bed_width/bed_height/pen_up_z across
    # unrelated changes instead of freezing at whatever those happened to be
    # the first time a calibration was saved. Use resolved_park() to read the
    # effective value; never read these fields directly.
    park_x: float | None = None
    park_y: float | None = None
    park_lift_z: float | None = None

    # Pen insertion / height calibration position, in bed coordinates.
    # Until customised, follow the bed centre. Z uses this profile's pen heights.
    calibration_x: float | None = None
    calibration_y: float | None = None
    # Manual insertion-height offset; positive means more pressure after insertion.
    # Normal C moves and plotting never apply this value automatically.
    calibration_pressure_offset: float = 0.0

    # Paper calibration: corner positions captured by jogging the head to the
    # sheet's corners (printer coordinates, mm). Keys: bl, br, tr, tl.
    paper_corners: dict = field(default_factory=dict)
    paper_margin: float = 0.0  # inset from plot_area_base to the effective plot area

    # No-go obstacle zones (e.g. clamps): list of dicts with keys
    # id, x, y, w, h  — all in printer/bed coordinates (mm).
    # Travel moves (pen-up) are routed around them; drawing moves through them
    # are rejected by the safety checker.
    obstacles: list = field(default_factory=list)

    # Maximum gap (mm) between two stroke endpoints that will be bridged into a
    # single continuous stroke without a pen lift.  Larger values reduce total
    # lifts but may silently connect strokes that were meant to be separate.
    merge_tolerance: float = 0.5

    def validated_pressure_depth(self) -> float:
        """Pressure travel must be finite and stay above machine Z=0."""
        try:
            depth = float(self.pen_pressure_max_depth)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                "Die maximale Zusatzabsenkung muss eine endliche, nicht negative Zahl sein."
            ) from exc
        if not math.isfinite(depth) or depth < 0:
            raise ValueError(
                "Die maximale Zusatzabsenkung muss eine endliche, nicht negative Zahl sein."
            )
        if depth > 0 and (
            not math.isfinite(self.pen_down_z) or depth > self.pen_down_z
        ):
            raise ValueError(
                "Die maximale Zusatzabsenkung würde unter Maschinen-Z 0 fahren. "
                "Sie darf die kalibrierte Stifthöhe nicht überschreiten."
            )
        return depth

    def resolved_park(self) -> tuple[float, float, float]:
        """(x, y, lift_z) for the end-of-job park move.

        Defaults to bed-centre/bed-max-Y and ``pen_up_z`` while the
        corresponding field is still ``None`` — computed fresh from the
        *current* bed size / pen height every time, so it keeps tracking
        those unless the user explicitly overrides it.
        """
        return (
            self.park_x if self.park_x is not None else self.bed_width / 2,
            self.park_y if self.park_y is not None else self.bed_height,
            self.park_lift_z if self.park_lift_z is not None else self.pen_up_z,
        )

    def resolved_calibration_position(self) -> tuple[float, float]:
        return (
            self.calibration_x if self.calibration_x is not None else self.bed_width / 2,
            self.calibration_y if self.calibration_y is not None else self.bed_height / 2,
        )

    @classmethod
    def path(cls) -> Path:
        return data_dir() / "calibration.json"

    @classmethod
    def from_dict(cls, data: dict) -> Calibration:
        known = {f.name for f in fields(cls)}
        cal = cls(**{k: v for k, v in data.items() if k in known})
        cal.pen_pressure_max_depth = cal.validated_pressure_depth()
        return cal

    @classmethod
    def load(cls) -> Calibration:
        path = cls.path()
        if not path.exists():
            return cls()
        return cls.from_dict(json.loads(path.read_text()))

    def save(self) -> None:
        self.path().write_text(json.dumps(asdict(self), indent=2))
        # The profile store is the source of truth; this file is only the
        # active-profile mirror for legacy callers. Push the change into the
        # active profile (lazy import — services may not be loadable in
        # stripped-down contexts, and a hard import would be circular).
        try:
            from plotter.services.profiles import sync_active_profile_calibration
        except ImportError:
            return
        sync_active_profile_calibration(self)

    def as_dict(self) -> dict:
        """Effective calibration for API responses / display — position fields
        resolved to concrete numbers. For persistence use ``asdict()``
        (the ``dataclasses`` free function) instead, which preserves the
        ``None`` "not yet customised" sentinel."""
        data = asdict(self)
        data["park_x"], data["park_y"], data["park_lift_z"] = self.resolved_park()
        data["calibration_x"], data["calibration_y"] = self.resolved_calibration_position()
        data["defined_positions"] = [
            kind for kind, axes in POSITION_FIELDS.items()
            if all(getattr(self, axis) is not None for axis in axes)
        ]
        return data

    def merged(self, updates: dict) -> Calibration:
        known = {f.name for f in fields(self)}
        data = asdict(self)
        data.update({k: v for k, v in updates.items() if k in known})
        # Validate jointly with pen_down_z so recalibration cannot silently
        # turn a formerly valid pressure depth into a movement below Z=0.
        candidate = Calibration(**data)
        data["pen_pressure_max_depth"] = candidate.validated_pressure_depth()
        area_fields = ("origin_x", "origin_y", "plot_width", "plot_height")
        explicit_base = updates.get("plot_area_base") is not None
        if explicit_base or "paper_margin" in updates or any(k in updates for k in area_fields):
            margin = self._plot_margin(data["paper_margin"])
            data["paper_margin"] = margin
            if explicit_base:
                base = self._validated_plot_area(updates["plot_area_base"])
            elif any(k in updates for k in area_fields):
                # Direct edits specify effective coordinates. Keep these
                # coordinates and recover their outer rectangle for future insets.
                base = self._validated_plot_area({
                    "x": data["origin_x"] - margin,
                    "y": data["origin_y"] - margin,
                    "w": data["plot_width"] + 2 * margin,
                    "h": data["plot_height"] + 2 * margin,
                })
                data["plot_area_base"] = dict(zip(("x", "y", "w", "h"), base, strict=True))
                return Calibration(**data)
            else:
                base = self.base_plot_area()
            x, y, width, height = base
            if width - 2 * margin < 5 or height - 2 * margin < 5:
                raise ValueError(
                    "Rand zu groß für den eingestellten Plotbereich (mindestens 5 × 5 mm)."
                )
            data.update({
                "origin_x": round(x + margin, 3),
                "origin_y": round(y + margin, 3),
                "plot_width": round(width - 2 * margin, 3),
                "plot_height": round(height - 2 * margin, 3),
                "plot_area_base": dict(zip(("x", "y", "w", "h"), base, strict=True)),
            })
        return Calibration(**data)

    @staticmethod
    def _plot_margin(margin: float) -> float:
        try:
            margin = float(margin)
        except (TypeError, ValueError) as exc:
            raise ValueError("Der Rand muss eine endliche, nicht negative Zahl sein.") from exc
        if not math.isfinite(margin) or margin < 0:
            raise ValueError("Der Rand muss eine endliche, nicht negative Zahl sein.")
        return margin

    @staticmethod
    def _validated_plot_area(area: dict) -> tuple[float, float, float, float]:
        try:
            values = tuple(float(area[key]) for key in ("x", "y", "w", "h"))
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(
                "Der allgemeine Plotbereich benötigt X, Y, Breite und Höhe als endliche Zahlen."
            ) from exc
        if not all(math.isfinite(value) for value in values):
            raise ValueError("Der allgemeine Plotbereich darf keine unendlichen Werte enthalten.")
        if values[2] <= 0 or values[3] <= 0:
            raise ValueError("Breite und Höhe des allgemeinen Plotbereichs müssen positiv sein.")
        return values

    def base_plot_area(self) -> tuple[float, float, float, float]:
        """General (x, y, width, height) rectangle before the current margin."""
        if self.plot_area_base is not None:
            return self._validated_plot_area(self.plot_area_base)
        margin = self._plot_margin(self.paper_margin)
        return self._validated_plot_area({
            "x": self.origin_x - margin, "y": self.origin_y - margin,
            "w": self.plot_width + 2 * margin, "h": self.plot_height + 2 * margin,
        })

    def paper_rect(self) -> tuple[float, float, float, float] | None:
        """Axis-aligned bounding box (x, y, width, height) of captured corners, or None.

        Needs at least two corners spanning both axes (e.g. bl + tr).
        Used for display / preview; explicit adoption uses paper_rect_inner().
        """
        pts = [
            p
            for p in self.paper_corners.values()
            if isinstance(p, (list, tuple)) and len(p) == 2
        ]
        if len(pts) < 2:
            return None
        xs = [float(p[0]) for p in pts]
        ys = [float(p[1]) for p in pts]
        width = max(xs) - min(xs)
        height = max(ys) - min(ys)
        if width < 1.0 or height < 1.0:
            return None
        return (min(xs), min(ys), width, height)

    def paper_rect_inner(self) -> tuple[float, float, float, float] | None:
        """Largest axis-aligned rectangle that fits *inside* the captured quadrilateral.

        With 4 corners this handles non-rectangular (tilted) paper correctly.
        With fewer corners it falls back to the bounding box.
        """
        pts = [
            [float(p[0]), float(p[1])]
            for p in self.paper_corners.values()
            if isinstance(p, (list, tuple)) and len(p) == 2
        ]
        if len(pts) < 2:
            return None
        if len(pts) < 4:
            return self.paper_rect()

        ys = [p[1] for p in pts]
        y_min, y_max = min(ys), max(ys)
        if y_max - y_min < 1.0:
            return None

        # Build edge list for the convex quadrilateral.
        # Order corners: tl → tr → br → bl (canonical quad order).
        order = ["tl", "tr", "br", "bl"]
        ordered = []
        for key in order:
            if key in self.paper_corners:
                p = self.paper_corners[key]
                if isinstance(p, (list, tuple)) and len(p) == 2:
                    ordered.append([float(p[0]), float(p[1])])
        if len(ordered) != 4:
            # Fall back if not all 4 canonical corners present.
            ordered = pts
        edges = [(ordered[i], ordered[(i + 1) % len(ordered)]) for i in range(len(ordered))]

        def x_range_at_y(y: float) -> tuple[float, float] | None:
            xs_at = []
            for (ax, ay), (bx, by) in edges:
                lo, hi = (ay, by) if ay <= by else (by, ay)
                if lo <= y <= hi and abs(by - ay) > 1e-9:
                    t = (y - ay) / (by - ay)
                    xs_at.append(ax + t * (bx - ax))
            if len(xs_at) < 2:
                return None
            return (min(xs_at), max(xs_at))

        # Restrict y to the "interior" range where the polygon has a
        # definite positive width.  For a convex quad, the two vertices with
        # the lowest y values define the bottom edge, and the two with the
        # highest y values define the top edge.  The inscribed rect y-range is
        # [max of bottom pair, min of top pair] – this avoids the degenerate
        # single-point extremes at y_min / y_max.
        ys_sorted = sorted(ys)
        y_inner_min = ys_sorted[1]   # 2nd lowest
        y_inner_max = ys_sorted[-2]  # 2nd highest

        if y_inner_max - y_inner_min < 1.0:
            # Fall back to full bounding rect when corners are nearly co-linear.
            return self.paper_rect()

        x_left_max = float("-inf")
        x_right_min = float("inf")
        sample_ys = sorted(set(ys) | {y_inner_min, y_inner_max})
        for sy in sample_ys:
            if not (y_inner_min <= sy <= y_inner_max):
                continue
            r = x_range_at_y(sy)
            if r and r[1] > r[0]:
                x_left_max = max(x_left_max, r[0])
                x_right_min = min(x_right_min, r[1])

        width = x_right_min - x_left_max
        height = y_inner_max - y_inner_min
        if width < 1.0 or height < 1.0:
            return None
        return (x_left_max, y_inner_min, width, height)


def same_plot_layout(saved: Calibration, current: Calibration) -> bool:
    """Whether already rendered coordinates still match the current setup."""
    fields_to_match = (
        "bed_width", "bed_height", "z_max", "plot_width", "plot_height",
        "origin_x", "origin_y", "paper_corners", "paper_margin", "flip_y",
        "pen_up_z", "pen_down_z", "pen_pressure_max_depth", "park_after_plot", "obstacles",
    )
    return (
        all(getattr(saved, key) == getattr(current, key) for key in fields_to_match)
        and saved.resolved_park() == current.resolved_park()
    )


def slide_calibration_differences(saved: Calibration, current: Calibration) -> str:
    """Give the user the actual values behind a refused slide plot."""
    labels = {
        "bed_width": "Bettbreite", "bed_height": "Betthöhe", "z_max": "Z-Grenze",
        "plot_width": "Plotbreite", "plot_height": "Plothöhe",
        "origin_x": "Ursprung X", "origin_y": "Ursprung Y",
        "paper_margin": "Papierrand", "pen_up_z": "Stift oben Z",
        "pen_down_z": "Stift unten Z",
        "pen_pressure_max_depth": "Maximale Zusatzabsenkung",
    }
    differences = [
        f"{label}: G-Code {getattr(saved, key):g} mm, Projekt {getattr(current, key):g} mm"
        for key, label in labels.items()
        if getattr(saved, key) != getattr(current, key)
    ]
    corner_names = {
        "bl": "unten links", "br": "unten rechts", "tr": "oben rechts", "tl": "oben links",
    }
    for key, label in corner_names.items():
        before = saved.paper_corners.get(key)
        after = current.paper_corners.get(key)
        if before != after:
            differences.append(f"Papierecke {label}: G-Code {before}, Projekt {after} (mm).")
    for key, label in (
        ("travel_feed", "Fahrtgeschwindigkeit"), ("draw_feed", "Zeichengeschwindigkeit"),
        ("z_feed", "Z-Geschwindigkeit"), ("z_max_feedrate", "Maximale Z-Geschwindigkeit"),
    ):
        if getattr(saved, key) != getattr(current, key):
            differences.append(
                f"{label}: G-Code {getattr(saved, key):g}, Projekt {getattr(current, key):g} mm/s"
            )
    if saved.flip_y != current.flip_y:
        differences.append("Die Y-Ausrichtung unterscheidet sich.")
    if (saved.park_after_plot != current.park_after_plot
            or saved.resolved_park() != current.resolved_park()):
        differences.append("Die Parkposition unterscheidet sich.")
    if saved.obstacles != current.obstacles:
        differences.append("Die Sperrbereiche unterscheiden sich.")
    return "; ".join(part.rstrip(".") for part in differences) + "." if differences else ""


def z_max_feedrate_line(cal: Calibration) -> str:
    """M203 Z<mm/s> — raise the firmware's RAM-only max Z feedrate so
    cal.z_feed isn't silently clamped by the printer's (often much lower)
    stock limit. Send this before any Z move that uses cal.z_feed."""
    return f"M203 Z{_rate_number(cal.z_max_feedrate)}"


def _rate_number(value: float) -> str:
    # Preserve small positive rates instead of rounding them to zero. Whole
    # values retain their existing compact G-code representation.
    return f"{value:.6f}".rstrip("0").rstrip(".")


def feed_word(mm_s: float) -> str:
    """G-code F-word for a feedrate stored in mm/s (F-word itself is mm/min)."""
    return f"F{_rate_number(mm_s * 60)}"
