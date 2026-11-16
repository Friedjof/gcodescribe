import type { WorkspaceId } from "../../interface/workspaces";
import type { SetupStep } from "../start/setup/setupProgress";
import type { CalibrationStep } from "../control/calibration/steps";
export interface TourStep {
  id: string;
  workspace: WorkspaceId;
  setup?: SetupStep;
  calibration?: CalibrationStep;
  target: string;
  anchor?: string;
  side: "right" | "bottom" | "left" | "top";
  icon:
    | "settings"
    | "plug"
    | "home"
    | "draw"
    | "pages"
    | "check"
    | "preview"
    | "shape"
    | "tabs";
}
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "profile",
    workspace: "paper",
    setup: "profile",
    target: "setup-profile-choice",
    side: "bottom",
    icon: "settings",
  },
  {
    id: "connection",
    workspace: "paper",
    setup: "connection",
    target: "setup-connection",
    side: "bottom",
    icon: "plug",
  },
  {
    id: "home",
    workspace: "calibrate",
    setup: "calibration",
    calibration: "home",
    target: "calibration-home",
    anchor: "calibration-tabs",
    side: "right",
    icon: "home",
  },
  {
    id: "pen",
    workspace: "calibrate",
    setup: "calibration",
    calibration: "pen",
    target: "calibration-pen",
    anchor: "calibration-tabs",
    side: "right",
    icon: "draw",
  },
  {
    id: "paper",
    workspace: "calibrate",
    setup: "calibration",
    calibration: "corners",
    target: "calibration-corners",
    anchor: "calibration-tabs",
    side: "right",
    icon: "pages",
  },
  {
    id: "review",
    workspace: "calibrate",
    setup: "calibration",
    calibration: "apply",
    target: "calibration-apply",
    anchor: "calibration-tabs",
    side: "right",
    icon: "check",
  },
  {
    id: "drawing",
    workspace: "paper",
    setup: "drawing",
    target: "setup-drawing",
    side: "right",
    icon: "draw",
  },
  {
    id: "preview",
    workspace: "paper",
    setup: "preview",
    target: "setup-preview",
    side: "right",
    icon: "preview",
  },
  {
    id: "canvas",
    workspace: "paint",
    target: "paint-tools",
    side: "right",
    icon: "shape",
  },
  {
    id: "templates",
    workspace: "games",
    target: "template-library",
    side: "right",
    icon: "pages",
  },
  {
    id: "workspaces",
    workspace: "games",
    target: "workspace-settings",
    side: "bottom",
    icon: "tabs",
  },
];
export const TOUR_STORAGE_KEY = "gcs.tour.v1";
export interface TourRecord {
  version: 1;
  state: "progress" | "dismissed" | "finished";
  step: number;
}
export function readTour(
  storage?: Pick<Storage, "getItem">,
): TourRecord | null {
  try {
    const value = JSON.parse(storage?.getItem(TOUR_STORAGE_KEY) ?? "null");
    if (
      value?.version !== 1 ||
      !["progress", "dismissed", "finished"].includes(value.state)
    )
      return null;
    return {
      version: 1,
      state: value.state,
      step: Number.isInteger(value.step)
        ? Math.max(0, Math.min(TOUR_STEPS.length - 1, value.step))
        : 0,
    };
  } catch {
    return null;
  }
}
export function writeTour(record: TourRecord) {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* The tour remains usable in restricted webviews. */
  }
}
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function placeTourCard(
  anchor: Rect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  side: TourStep["side"],
) {
  const margin = 12,
    gap = 14;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  if (!anchor)
    return {
      left: Math.max(margin, (viewport.width - card.width) / 2),
      top: Math.max(margin, (viewport.height - card.height) / 2),
    };
  const candidates = {
    right: { left: anchor.left + anchor.width + gap, top: anchor.top },
    left: { left: anchor.left - card.width - gap, top: anchor.top },
    bottom: {
      left: anchor.left + anchor.width - card.width,
      top: anchor.top + anchor.height + gap,
    },
    top: {
      left: anchor.left + anchor.width - card.width,
      top: anchor.top - card.height - gap,
    },
  };
  const fits = (point: { left: number; top: number }) =>
    point.left >= margin &&
    point.top >= margin &&
    point.left + card.width <= viewport.width - margin &&
    point.top + card.height <= viewport.height - margin;
  const order = [
    side,
    ...(["right", "left", "bottom", "top"] as const).filter(
      (item) => item !== side,
    ),
  ];
  const point =
    order.map((item) => candidates[item]).find(fits) ?? candidates[side];
  return {
    left: clamp(point.left, margin, viewport.width - card.width - margin),
    top: clamp(point.top, margin, viewport.height - card.height - margin),
  };
}
