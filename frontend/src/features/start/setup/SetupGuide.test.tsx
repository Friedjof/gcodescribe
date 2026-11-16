// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SetupGuide from "./SetupGuide";
import { SetupProgressProvider } from "./SetupProgressProvider";
import type { CalibrationProfile, PageIndex } from "../../../api";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), setIndex: vi.fn() }));
vi.mock("../../../state/ProjectCalibrationContext", () => ({
  useProjectCalibration: () => mocks,
}));
vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("./SetupProjectSelect", () => ({ default: () => <div>Project selector</div> }));
vi.mock("./SetupDrawingStep", () => ({
  default: ({ onNext }: { onNext: () => void }) => (
    <button onClick={onNext}>Drawing ready</button>
  ),
}));
vi.mock("./SetupPreviewStep", () => ({
  default: ({
    onReviewed,
    onFinish,
    ready,
  }: {
    onReviewed: (id: string, n: number, fp: string) => void;
    onFinish: () => void;
    ready: boolean;
  }) => (
    <>
      <span>{ready ? "Machine ready" : "Setup incomplete"}</span>
      <button
        onClick={() => {
          onReviewed("page", 1, "fp");
          onFinish();
        }}
      >
        Finish preview
      </button>
    </>
  ),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
const profile = {
  id: "profile",
  name: "Printer",
  fingerprint: "fp",
  calibration: {
    bed_width: 210,
    bed_height: 210,
    plot_width: 200,
    plot_height: 200,
    pen_up_z: 5,
    pen_down_z: 0,
    pen_calibrated: true,
  },
} as CalibrationProfile;
const index = {
  project: { id: "project", name: "Project", profileId: "profile" },
  activeId: "page",
  order: [{ id: "page", objectCount: 1, modified: 1 }],
} as PageIndex;
it("guides a connected user through explicit confirmation and invalidates a changed calibration", () => {
  const props = {
    index,
    profile,
    status: { configured: true, online: true },
    visible: true,
    onSettings: vi.fn(),
    onNavigate: vi.fn(),
    onAction: vi.fn(),
  };
  const view = render(
    <SetupProgressProvider>
      <SetupGuide {...props} />
    </SetupProgressProvider>,
  );
  expect(
    screen
      .getByRole("button", { name: /setup.step.connection/ })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "setup.useExisting" }));
  fireEvent.click(
    screen.getByRole("button", { name: "setup.continueCalibration" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "profiles.openVisual" }));
  expect(props.onNavigate).toHaveBeenCalledWith("calibrate");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "setup.confirmCalibration" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "setup.continueDrawing" }),
  );
  fireEvent.click(screen.getByText("Drawing ready"));
  fireEvent.click(screen.getByText("Finish preview"));
  expect(screen.getByText("setup.readyTitle")).toBeTruthy();
  view.rerender(
    <SetupProgressProvider>
      <SetupGuide {...props} profile={{ ...profile, fingerprint: "changed" }} />
    </SetupProgressProvider>,
  );
  expect(screen.getByText("setup.preparedTitle")).toBeTruthy();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("keeps incomplete calibration visible after offline page preparation and disables hidden controls", () => {
  const props = {
    index,
    profile: {
      ...profile,
      calibration: { ...profile.calibration, pen_calibrated: false },
    },
    status: { configured: false },
    visible: false,
    onSettings: vi.fn(),
    onNavigate: vi.fn(),
    onAction: vi.fn(),
  };
  render(
    <SetupProgressProvider>
      <SetupGuide {...props} />
    </SetupProgressProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "setup.useExisting" }));
  fireEvent.click(screen.getByRole("button", { name: "setup.prepareOffline" }));
  expect(screen.getByRole("button", { name: "profiles.openVisual" }).hasAttribute("disabled")).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "setup.continueDrawing" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "setup.skipCalibration" }),
  );
  fireEvent.click(screen.getByText("Drawing ready"));
  fireEvent.click(screen.getByText("Finish preview"));
  expect(screen.getByText("setup.preparedTitle")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "setup.finishMachineSetup" }),
  ).toBeTruthy();
});
