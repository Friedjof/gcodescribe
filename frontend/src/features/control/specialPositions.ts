import type { Calibration, PositionKind } from "../../api";

/** Add new position types here; the panel and map share these definitions. */
export const SPECIAL_POSITIONS = [
  { kind: "park", marker: "P", label: "paper.legPark", hint: "paper.positions.parkHint",
    color: "var(--warn)", x: "park_x", y: "park_y" },
  { kind: "calibration", marker: "C", label: "calibrate.groupCalibrationPosition", hint: "paper.positions.calibrationHint",
    color: "var(--accent)", x: "calibration_x", y: "calibration_y" },
] as const;

export interface PositionTarget { kind: PositionKind; x: number; y: number }

export function positionDefinition(kind: PositionKind) {
  return SPECIAL_POSITIONS.find((point) => point.kind === kind)!;
}

export function savedPosition(cal: Calibration, kind: PositionKind) {
  const point = positionDefinition(kind);
  return { x: cal[point.x], y: cal[point.y] };
}
