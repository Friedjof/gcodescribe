// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CalibrationWizard from "./CalibrationWizard";
import { calibrationSteps, type CalibrationStep } from "./steps";
import type { CalibrationController } from "./useCalibrationController";

const tour = vi.hoisted(() => ({ step: { id: "pen", calibration: "pen" as CalibrationStep }, request: 1, followCalibration: vi.fn() }));
vi.mock("../../tour/TourProvider", () => ({ useAppTour: () => tour }));
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./GuidedCalibrationStep", () => ({ default: ({ id }: { id: string }) => <div data-testid="task">{id}</div> }));
beforeEach(() => { tour.step = { id: "pen", calibration: "pen" }; tour.request = 1; tour.followCalibration.mockReset(); });
afterEach(cleanup);
function Wizard() {
  const [active, setActive] = useState<CalibrationStep>("home");
  const controls = {
    steps: calibrationSteps({ homed: false, heightSaved: false, hasPaper: false, positionsDone: false }),
    positions: { busy: false }, busy: false, active, setActive, visible: true, online: false,
  } as CalibrationController;
  return <CalibrationWizard controls={controls} guided />;
}
it("previews the requested locked pen step without unlocking its machine prerequisites", () => {
  render(<Wizard />);
  expect(screen.getByTestId("task").textContent).toBe("pen");
  expect(screen.getByRole("status").textContent).toBe("tour.offlinePreview");
  expect((screen.getByRole("button", { name: /paper.nav.pen/ }) as HTMLButtonElement).disabled).toBe(true);
});
it("does not override an explicit calibration step choice while the explanation is unchanged", () => {
  render(<Wizard />);
  fireEvent.click(screen.getByRole("button", { name: /paper.nav.positions/ }));
  expect(screen.getByTestId("task").textContent).toBe("positions");
  expect(tour.followCalibration).toHaveBeenLastCalledWith("positions");
});
