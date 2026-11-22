export type CalibrationStep = "home" | "pen" | "positions" | "corners" | "obstacles" | "apply";

export const CORNERS = [
  { id: "tl", labelKey: "paper.cornerTL" }, { id: "tr", labelKey: "paper.cornerTR" },
  { id: "bl", labelKey: "paper.cornerBL" }, { id: "br", labelKey: "paper.cornerBR" },
];
export const XY_STEPS = [0.1, 1, 10, 50];
export const Z_STEPS = [0.05, 0.1, 0.5, 1, 5];

interface Step { id: CalibrationStep; titleKey: string; done: boolean; locked: boolean; optional?: boolean }

export function calibrationSteps({ homed, heightSaved, hasPaper, positionsDone }: {
  homed: boolean; heightSaved: boolean; hasPaper: boolean; positionsDone: boolean;
}): Step[] {
  return [
    { id: "home", titleKey: "paper.step1", done: homed, locked: false },
    { id: "positions", titleKey: "paper.positions.title", done: positionsDone, locked: false },
    { id: "pen", titleKey: "paper.step2", done: heightSaved, locked: !homed && !heightSaved },
    { id: "corners", titleKey: "paper.step3", done: hasPaper, locked: false },
    { id: "apply", titleKey: "paper.step5", done: false, locked: false },
    { id: "obstacles", titleKey: "paper.step4Obstacles", done: false, locked: !hasPaper, optional: true },
  ];
}
