// @vitest-environment jsdom

import { ProjectCalibrationProvider } from "../../state/ProjectCalibrationContext";
import type { ReactElement } from "react";
vi.mock("../../api/events", () => ({ onAppEvent: () => () => {} }));
import { act, cleanup, fireEvent, render as renderComponent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Paper from "./Paper";
import { ApiError } from "../../api/errors";
import type { Calibration, Position, PositionKind } from "../../api";

const render = (ui: ReactElement) => renderComponent(ui, { wrapper: ({ children }) =>
  <ProjectCalibrationProvider active={true}>{children}</ProjectCalibrationProvider> });

const mocks = vi.hoisted(() => ({
  paper: vi.fn(), profileCalibration: vi.fn(), position: vi.fn(), activeProfile: vi.fn(), listJobs: vi.fn(),
  listPages: vi.fn(), activateProfile: vi.fn(), saveProfile: vi.fn(), getProfile: vi.fn(),
  raisePen: vi.fn(), testDot: vi.fn(), move: vi.fn(), moveToPosition: vi.fn(), positionFromHead: vi.fn(), pen: vi.fn(),
  saveCalibration: vi.fn(), jog: vi.fn(), error: vi.fn(),
  homeAndMoveToPosition: vi.fn(), home: vi.fn(), penFromPosition: vi.fn(),
  setCorner: vi.fn(), clearCorner: vi.fn(), resetPaper: vi.fn(), applyPaper: vi.fn(),
  setCornerAt: vi.fn(), moveToCorner: vi.fn(), setObstacles: vi.fn(), testPattern: vi.fn(), send: vi.fn(),
}));
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({
  t: (key: string, vars?: Record<string, string>) => key === "paper.context"
    ? `${key} ${vars?.project} ${vars?.profile}` : key + (vars?.marker ? ` ${vars.marker}` : ""),
}) }));
vi.mock("../../components/Toasts", () => ({ useToasts: () => ({ error: mocks.error, success: vi.fn() }) }));

const cal: Calibration = {
  bed_width: 210, bed_height: 210, z_max: 205, plot_width: 200, plot_height: 200,
  origin_x: 5, origin_y: 5, pen_up_z: 5, pen_down_z: 1, pen_calibrated: true,
  travel_feed: 100, draw_feed: 50, z_feed: 26.7, z_max_feedrate: 60,
  fit_to_area: true, flip_y: true, trust_axis_home: false,
  park_after_plot: true, park_x: 105, park_y: 210, park_lift_z: 10,
  calibration_x: 105, calibration_y: 105, paper_corners: { bl: [10, 10], tr: [200, 200] },
  defined_positions: [],
  paper_margin: 0, obstacles: [], merge_tolerance: 0.5,
};
let head: Position;
let profileCalibration: Calibration;
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  head = { x: 20, y: 30, z: 5, homed: true, homed_axes: ["x", "y", "z"] };
  profileCalibration = { ...cal };
  mocks.paper.mockImplementation(async () => ({ calibration: profileCalibration, rect: [10, 10, 190, 190] }));
  mocks.activeProfile.mockImplementation(async () => ({ id: "active", name: "Active",
    fingerprint: "machine", calibration: { ...cal, origin_x: 1, pen_down_z: 4 } }));
  mocks.getProfile.mockImplementation(async (id) => ({ id, name: "Project profile",
    fingerprint: id === "project-profile" ? "project" : id, calibration: profileCalibration }));
  mocks.listPages.mockResolvedValue({ project: { id: "project", name: "Project", profileId: "project-profile" },
    activeProfile: { id: "project-profile", name: "Project profile", fingerprint: "project",
      plot_width: 200, plot_height: 200, origin_x: 5, origin_y: 5 } });
  mocks.activateProfile.mockImplementation(async (id) => ({ id, name: "Project", calibration: profileCalibration }));
  mocks.profileCalibration.mockImplementation(async (id, signal) => {
    const profile = await mocks.getProfile(id, signal);
    const paper = await mocks.paper({ profileId: id }, signal);
    return { profile, paper };
  });
  mocks.position.mockImplementation(async () => ({ ...head }));
  mocks.listJobs.mockResolvedValue([]);
  mocks.home.mockResolvedValue({ ok: true, position: head });
  mocks.jog.mockResolvedValue({ ok: true, position: head });
  mocks.moveToCorner.mockResolvedValue({ ok: true, position: head });
  mocks.penFromPosition.mockImplementation(async () => profileCalibration);
  mocks.saveCalibration.mockImplementation(async (updates) => {
    profileCalibration = { ...profileCalibration, ...updates };
    return profileCalibration;
  });
  for (const method of [mocks.setCorner, mocks.clearCorner, mocks.resetPaper, mocks.applyPaper,
    mocks.setCornerAt, mocks.setObstacles]) {
    method.mockImplementation(async () => ({ calibration: profileCalibration, rect: [10, 10, 190, 190] }));
  }
  mocks.testPattern.mockResolvedValue({ filename: "frame.gcode" });
  mocks.send.mockResolvedValue({ ok: true });
  mocks.move.mockResolvedValue({ ok: true, position: head });
  mocks.moveToPosition.mockImplementation(async (kind, target, _scope, liftOnly) => {
    head = { ...head, ...(target ?? { x: profileCalibration.calibration_x, y: kind === "park" ? profileCalibration.park_y : profileCalibration.calibration_y }), z: liftOnly ? head.z : kind === "park" ? 10 : 1 };
    return { ok: true, position: { ...head } };
  });
  mocks.homeAndMoveToPosition.mockImplementation(async (kind) => {
    head = { ...head, x: 105, y: kind === "park" ? 210 : 105, homed: true, homed_axes: ["x", "y", "z"] };
    return { ok: true, position: head };
  });
  mocks.positionFromHead.mockImplementation(async (kind) => {
    profileCalibration = { ...profileCalibration,
      [kind === "park" ? "park_x" : "calibration_x"]: head.x,
      [kind === "park" ? "park_y" : "calibration_y"]: head.y,
      defined_positions: [...new Set([...(profileCalibration.defined_positions ?? []), kind])],
    };
    return profileCalibration;
  });
  mocks.raisePen.mockImplementation(async () => ({ ok: true, position: head }));
  mocks.testDot.mockResolvedValue({ ok: true, position: head });
  mocks.pen.mockImplementation(async (down) => {
    head = { ...head, z: down ? 1 : 5 };
    return { ok: true, z: head.z, position: head };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function setup(status = { online: true }) {
  const onAction = vi.fn();
  const view = render(<Paper status={{ configured: true, ...status }} onAction={onAction} />);
  await screen.findByRole("button", { name: /paper.positions.title/ });
  await waitFor(() => {
    const toggle = screen.getByRole("button", { name: "paper.clickMove" });
    if (status.online === false) expect(toggle).toBeDisabled();
    else expect(toggle).toBeEnabled();
  });
  const svg = view.container.querySelector("svg")!;
  Object.defineProperty(svg, "createSVGPoint", { value: () => ({
    x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; },
  }) });
  Object.defineProperty(svg, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
  if (status.online !== false && !("motion_locked" in status && status.motion_locked) && !("job" in status)) {
    await waitFor(() => expect(screen.getByRole("button", { name: "paper.homeXYZ" })).toBeEnabled());
  }
  return { ...view, svg, onAction };
}

it("uses the project's complete calibration even when the global profile differs", async () => {
  mocks.listPages.mockResolvedValue({ project: { id: "project", name: "Formelsammlungen", profileId: "project-profile" },
    activeProfile: { id: "project-profile", name: "Formelsammlungen – Profil",
      fingerprint: "project", plot_width: 166, plot_height: 205, origin_x: 1, origin_y: 4 } });
  profileCalibration = { ...cal, origin_x: 25, plot_width: 140, pen_down_z: 2 };
  await setup();
  expect(screen.getByText('paper.context Formelsammlungen Project profile')).toBeInTheDocument();
  expect(mocks.getProfile).toHaveBeenCalledWith("project-profile", expect.any(AbortSignal));
  expect(mocks.paper).not.toHaveBeenCalled();
  expect(mocks.activeProfile).not.toHaveBeenCalled();
  expect(screen.queryByRole("img", { name: "A5 148 × 210 mm" })).not.toBeInTheDocument();
  expect(mocks.activateProfile).not.toHaveBeenCalled();
});

it("keeps the plot area passive without resize handles", async () => {
  const { svg } = await setup();
  expect(svg.querySelector(".plot-edge-handle")).toBeNull();
  expect(screen.queryByLabelText("paper.plotEdge.left")).not.toBeInTheDocument();
  const drawing = screen.getByRole("img", { name: "paper.drawingArea" });
  expect(drawing).toHaveAttribute("pointer-events", "none");
  expect(drawing.querySelector("rect")).toHaveAttribute("stroke", "var(--muted)");
  expect(mocks.saveCalibration).not.toHaveBeenCalled();
});

async function openPositions() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.positions.title/ })); }); }
function targetClick(svg: SVGSVGElement) { fireEvent.click(svg, { clientX: 40, clientY: 180 }); }

it("puts positions before pen height before optional settings and requires explicit click-to-move", async () => {
  const { container, svg } = await setup();
  const steps = Array.from(container.querySelectorAll(".wstep-title")).map((el) => el.textContent);
  expect(steps).toEqual(["paper.step1", "paper.positions.title", "paper.step2", "paper.step3", "paper.step5", "paper.step4Obstacles"]);
  expect(container.querySelector("section")?.querySelector(".wizard")).not.toBeNull();
  const toggle = screen.getByRole("button", { name: "paper.clickMove" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  targetClick(svg);
  expect(mocks.move).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  await openPositions();
  expect(toggle).toBeDisabled();
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByText("paper.editPositions")).not.toBeInTheDocument();
  await openPositions();
  expect(toggle).toBeEnabled();
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  targetClick(svg);
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith(40, 30, "project"));
  expect(mocks.moveToPosition).not.toHaveBeenCalled();
});

it.each(["paper.legPark", "calibrate.groupCalibrationPosition"])("positions %s directly on the board without saving, then explicitly captures it", async (marker) => {
  const { svg } = await setup();
  const kind = marker === "paper.legPark" ? "park" : "calibration";
  await openPositions();
  fireEvent.click(screen.getByRole("button", { name: marker }));
  expect(mocks.moveToPosition).not.toHaveBeenCalled();
  targetClick(svg);
  await waitFor(() => expect(screen.getByRole("button", { name: `paper.positions.capture ${marker}` })).toBeEnabled());
  expect(mocks.moveToPosition).toHaveBeenLastCalledWith(kind, { x: 40, y: 30 }, "project", true);
  expect(mocks.move).not.toHaveBeenCalled();
  expect(mocks.saveCalibration).not.toHaveBeenCalled();
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
  expect(screen.getByRole("img", { name: `${marker} · paper.positions.target` })).toBeInTheDocument();
  fireEvent.click(svg, { clientX: 50, clientY: 180 });
  await waitFor(() => expect(mocks.moveToPosition).toHaveBeenLastCalledWith(kind, { x: 50, y: 30 }, "project", true));
  await waitFor(() => expect(screen.getByRole("button", { name: `paper.positions.capture ${marker}` })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: `paper.positions.capture ${marker}` }));
  await waitFor(() => expect(mocks.positionFromHead).toHaveBeenCalledWith(kind, "project"));
  await waitFor(() => expect(screen.queryByRole("img", { name: `${marker} · paper.positions.target` })).not.toBeInTheDocument());
});

it("shows three coordinate columns and uses the board without extra movement controls", async () => {
  const { container } = await setup();
  await openPositions();
  expect(Array.from(container.querySelectorAll(".position-coordinates dt"), (el) => el.textContent))
    .toEqual(["paper.positions.stored", "paper.positions.head", "paper.positions.target"]);
  expect(container.querySelector(".position-target dd")).toHaveTextContent("—");
  expect(screen.queryByRole("button", { name: "paper.positions.visit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "paper.penDownShort" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "X +" })).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "ArrowRight" });
  fireEvent.keyDown(window, { key: "PageDown" });
  expect(mocks.moveToPosition).not.toHaveBeenCalled();
  expect(mocks.pen).not.toHaveBeenCalled();
  expect(mocks.jog).not.toHaveBeenCalled();
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
});

it("serializes commands and clears the unsaved target after a failed move", async () => {
  const { svg } = await setup();
  let reject!: (e: Error) => void;
  mocks.moveToPosition.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  await openPositions();
  targetClick(svg);
  expect(screen.getByRole("button", { name: "calibrate.groupCalibrationPosition" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "paper.positions.capture calibrate.groupCalibrationPosition" })).toBeDisabled();
  targetClick(svg);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(mocks.moveToPosition).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("offline")));
  expect(mocks.error).toHaveBeenCalledWith("offline");
  expect(screen.queryByRole("img", { name: "calibrate.groupCalibrationPosition · paper.positions.target" })).not.toBeInTheDocument();
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
});

it.each([{ online: false }, { online: true, motion_locked: true }, { online: true, job: { state: "Printing" } }])(
  "blocks clicks, jogs, and capturing when unavailable: %j", async (status) => {
    const { svg } = await setup(status);
    await openPositions();
    targetClick(svg);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "paper.positions.capture calibrate.groupCalibrationPosition" })).toBeDisabled();
    expect(mocks.moveToPosition).not.toHaveBeenCalled();
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.positionFromHead).not.toHaveBeenCalled();
  }
);

it("discards targets on tab changes and keeps the user's click-to-move preference", async () => {
  const { svg, rerender, onAction } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "paper.clickMove" }));
  await openPositions();
  targetClick(svg);
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.positions.capture calibrate.groupCalibrationPosition" })).toBeEnabled());
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible={false} />);
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible={true} />);
  await screen.findByRole("button", { name: /paper.positions.title/ });
  expect(screen.getByRole("button", { name: /paper.positions.title/ })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: "paper.clickMove" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("img", { name: "calibrate.groupCalibrationPosition · paper.positions.target" })).not.toBeInTheDocument();
});

it("keeps special positions readable but blocks motion and capture before homing", async () => {
  head = { ...head, homed: false, homed_axes: [] };
  const { container } = render(<Paper status={{ configured: true, online: true }} onAction={vi.fn()} />);
  await screen.findByRole("button", { name: /paper.positions.title/ });
  await openPositions();
  expect(screen.getByText("paper.positions.stored")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "paper.positions.capture calibrate.groupCalibrationPosition" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "paper.preparePen →" })).toBeDisabled();
  fireEvent.click(container.querySelector("svg")!, { clientX: 40, clientY: 180 });
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(mocks.moveToPosition).not.toHaveBeenCalled();
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
});

it.each<{ defined: PositionKind[] }>([{ defined: [] }, { defined: ["park"] }])("accepts the displayed setup position without requiring a custom park point: $defined", async ({ defined }) => {
  profileCalibration = { ...cal, defined_positions: defined };
  await setup(); await openPositions();
  fireEvent.click(screen.getByRole("button", { name: "paper.preparePen →" }));
  await waitFor(() => expect(mocks.moveToPosition).toHaveBeenCalledWith("calibration", undefined, "project", true));
  expect(mocks.saveCalibration).toHaveBeenCalledWith({ calibration_x: 105, calibration_y: 105 }, "project");
  await waitFor(() => expect(screen.getByRole("button", { name: /paper.positions.title/ }).querySelector(".badge")).toHaveClass("done"));
});

it("marks positions complete after the setup trip and invalidates completion when the point changes", async () => {
  const { svg } = await setup();
  const step = screen.getByRole("button", { name: /paper.positions.title/ });
  await openPositions();
  for (const marker of ["paper.legPark", "calibrate.groupCalibrationPosition"]) {
    fireEvent.click(screen.getByRole("button", { name: marker }));
    targetClick(svg);
    const capture = screen.getByRole("button", { name: `paper.positions.capture ${marker}` });
    await waitFor(() => expect(capture).toBeEnabled());
    fireEvent.click(capture);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(`paper.positions.saved ${marker}`));
  }
  expect(step.querySelector(".badge")).not.toHaveClass("done");
  fireEvent.click(screen.getByRole("button", { name: "paper.preparePen →" }));
  await waitFor(() => expect(step.querySelector(".badge")).toHaveClass("done"));
  expect(step.querySelector(".badge")).toHaveTextContent("✓");
  await openPositions();
  await waitFor(() => expect(step.querySelector(".badge")).toHaveClass("done"));
  fireEvent.click(svg, { clientX: 60, clientY: 180 });
  const capture = screen.getByRole("button", { name: "paper.positions.capture calibrate.groupCalibrationPosition" });
  await waitFor(() => expect(capture).toBeEnabled());
  fireEvent.click(capture);
  await waitFor(() => expect(step.querySelector(".badge")).not.toHaveClass("done"));
});

it("accepts previously defined positions on Next without carrying completion to another profile", async () => {
  profileCalibration = { ...cal, defined_positions: ["park", "calibration"] };
  await setup();
  const step = screen.getByRole("button", { name: /paper.positions.title/ });
  await openPositions();
  fireEvent.click(screen.getByRole("button", { name: "paper.preparePen →" }));
  await waitFor(() => expect(step.querySelector(".badge")).toHaveClass("done"));
  mocks.listPages.mockResolvedValue({ project: { id: "other-project", name: "Other", profileId: "other" },
    activeProfile: { id: "other", fingerprint: "other" } });
  await waitFor(() => expect(screen.getByRole("button", { name: /paper.positions.title/ }).querySelector(".badge")).not.toHaveClass("done"), { timeout: 3000 });
});

it("clears the target when the active profile changes while the step remains open", async () => {
  const { svg } = await setup();
  await openPositions();
  targetClick(svg);
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.positions.capture calibrate.groupCalibrationPosition" })).toBeEnabled());
  expect(screen.getByRole("img", { name: "calibrate.groupCalibrationPosition · paper.positions.target" })).toBeInTheDocument();
  mocks.listPages.mockResolvedValue({ project: { id: "other-project", name: "Other", profileId: "other" },
    activeProfile: { id: "other", fingerprint: "other" } });
  await waitFor(() => expect(screen.queryByRole("img", { name: "calibrate.groupCalibrationPosition · paper.positions.target" })).not.toBeInTheDocument(), { timeout: 3000 });
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
});

it.each(["paper.legPark", "calibrate.groupCalibrationPosition"])("explicitly homes then visits saved %s, including before homing", async (marker) => {
  head = { ...head, homed: false, homed_axes: [] };
  render(<Paper status={{ configured: true, online: true }} onAction={vi.fn()} />);
  await screen.findByRole("button", { name: /paper.positions.title/ });
  await openPositions();
  fireEvent.click(screen.getByRole("button", { name: marker }));
  const visit = screen.getByRole("button", { name: `paper.positions.homeVisit ${marker}` });
  expect(visit).toHaveAttribute("title", `paper.positions.homeHint ${marker}`);
  await waitFor(() => expect(visit).toBeEnabled());
  fireEvent.click(visit);
  await waitFor(() => expect(mocks.homeAndMoveToPosition).toHaveBeenCalledWith(marker === "paper.legPark" ? "park" : "calibration", "project", true));
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
  expect(mocks.moveToPosition).not.toHaveBeenCalled();
});

it("starts format comparison off and never changes calibration when choosing a paper size", async () => {
  await setup();
  const formats = screen.getByRole("combobox", { name: "paper.formatCompare" });
  expect(formats).toHaveValue("");
  expect(screen.queryByRole("img", { name: "A5 148 × 210 mm" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "A3" })).not.toBeInTheDocument();
  fireEvent.change(formats, { target: { value: "A5" } });
  expect(screen.getByRole("img", { name: "A5 148 × 210 mm" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /paper.portrait/ }));
  expect(screen.getByRole("img", { name: "A5 210 × 148 mm" })).toBeInTheDocument();
  fireEvent.change(formats, { target: { value: "A6" } });
  expect(screen.getByRole("img", { name: "A6 148 × 105 mm" })).toBeInTheDocument();
  fireEvent.change(formats, { target: { value: "" } });
  expect(screen.queryByRole("img", { name: "A6 148 × 105 mm" })).not.toBeInTheDocument();
  expect(mocks.saveCalibration).not.toHaveBeenCalled();
  expect(mocks.saveProfile).not.toHaveBeenCalled();
  expect(mocks.applyPaper).not.toHaveBeenCalled();
});

it("homes, jogs, and captures and tests pen heights using the displayed project", async () => {
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "paper.homeXYZ" }));
  await waitFor(() => expect(mocks.home).toHaveBeenCalledWith(undefined, "project"));
  await screen.findByRole("button", { name: "paper.preparePen →" });
  fireEvent.click(screen.getByRole("button", { name: "paper.preparePen →" }));
  await screen.findByRole("button", { name: "paper.saveAsDown" });
  fireEvent.click(screen.getByRole("button", { name: "Z + 0.1" }));
  await waitFor(() => expect(mocks.jog).toHaveBeenCalledWith(0, 0, 0.1, { projectId: "project" }));
  fireEvent.click(screen.getByRole("button", { name: "paper.saveAsDown" }));
  await waitFor(() => expect(mocks.penFromPosition).toHaveBeenCalledWith("down", "project"));
  fireEvent.click(screen.getByRole("button", { name: "paper.testLower" }));
  await waitFor(() => expect(mocks.pen).toHaveBeenCalledWith(true, "project"));
  expect(mocks.activeProfile).not.toHaveBeenCalled();
});

it("captures, visits and applies project paper corners, and creates its frame test", async () => {
  await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step3/ })); });
  const capture = screen.getByRole("button", { name: "calibration.captureCorner" });
  fireEvent.click(capture);
  await waitFor(() => expect(mocks.setCorner).toHaveBeenCalledWith("bl", "project", { mode: "manual", diagonal: "bl-tr" }));
  fireEvent.change(screen.getByRole("combobox", { name: "calibration.corner" }), { target: { value: "bl" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.driveCorner" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "paper.driveCorner" }));
  await waitFor(() => expect(mocks.moveToCorner).toHaveBeenCalledWith("bl", "paper", "project"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step5/ })); });
  fireEvent.click(screen.getByRole("button", { name: "paper.applyMargin" }));
  await waitFor(() => expect(mocks.applyPaper).toHaveBeenCalledWith(0, "project"));
  fireEvent.click(screen.getByRole("button", { name: "paper.testFrame" }));
  await waitFor(() => expect(mocks.testPattern).toHaveBeenCalledWith("frame", "project"));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("frame.gcode", true));
  expect(screen.getByRole("link", { name: "common.exportXml" })).toHaveAttribute("href", "/api/calibration/export?project_id=project");
  expect(mocks.activeProfile).not.toHaveBeenCalled();
});

it("opens insertion pressure for the project profile instead of the global profile", async () => {
  await setup();
  await openPositions();
  fireEvent.click(screen.getByRole("button", { name: "calibrate.groupCalibrationPosition" }));
  fireEvent.click(screen.getByRole("button", { name: "paper.pressure.title" }));
  await screen.findByRole("dialog");
  await screen.findByText("paper.pressure.hint");
  expect(mocks.getProfile).toHaveBeenLastCalledWith("project-profile");
  expect(mocks.activeProfile).not.toHaveBeenCalled();
});

it("applies zero margin to the existing base and only uses paper corners on explicit action", async () => {
  const base = { x: 25, y: 8, w: 140, h: 190 };
  profileCalibration = { ...cal, plot_area_base: base, paper_margin: 5,
    origin_x: 30, origin_y: 13, plot_width: 130, plot_height: 180 };
  mocks.applyPaper.mockImplementation(async (margin) => {
    profileCalibration = { ...profileCalibration, paper_margin: margin,
      origin_x: base.x + margin, origin_y: base.y + margin,
      plot_width: base.w - 2 * margin, plot_height: base.h - 2 * margin };
    return { calibration: profileCalibration, rect: [10, 10, 190, 190] };
  });
  await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step5/ })); });
  fireEvent.change(screen.getByRole("spinbutton", { name: "paper.margin" }), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "paper.applyMargin" }));
  await waitFor(() => expect(mocks.applyPaper).toHaveBeenCalledWith(0, "project"));
  const drawing = screen.getByRole("img", { name: "paper.drawingArea" }).querySelector("rect")!;
  await waitFor(() => expect(drawing).toHaveAttribute("x", "25"));
  expect(drawing).toHaveAttribute("width", "140");
  expect(drawing).toHaveAttribute("height", "190");
  fireEvent.click(screen.getByRole("button", { name: "paper.fromCorners" }));
  await waitFor(() => expect(mocks.applyPaper).toHaveBeenLastCalledWith(0, "project", true));
});

it("allows margin changes without calibrated paper corners", async () => {
  profileCalibration = { ...cal, paper_corners: {} };
  mocks.paper.mockImplementation(async () => ({ calibration: profileCalibration, rect: null }));
  await setup();
  const step = screen.getByRole("button", { name: /paper.step5/ });
  expect(step).toBeEnabled();
  await act(async () => { fireEvent.click(step); });
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.applyMargin" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "paper.fromCorners" })).toBeDisabled();
});


it("follows the main setup path without requiring custom positions or obstacles", async () => {
  await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "paper.continueSetup" })); });
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.preparePen →" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "paper.preparePen →" }));
  await screen.findByRole("button", { name: "paper.toCorners" });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "paper.toCorners" })); });
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.usePaperArea" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "paper.usePaperArea" }));
  await waitFor(() => expect(mocks.applyPaper).toHaveBeenCalledWith(0, "project", true));
  await screen.findByRole("button", { name: "paper.applyMargin" });
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
  expect(mocks.setObstacles).not.toHaveBeenCalled();
});

it("can keep the current plot area without capturing paper corners", async () => {
  profileCalibration = { ...profileCalibration, paper_corners: {} };
  mocks.paper.mockResolvedValue({ calibration: profileCalibration, rect: null });
  await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step3/ })); });
  expect(screen.getByRole("button", { name: "paper.usePaperArea" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "paint.moreActions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "paper.useCurrentArea" }));
  await screen.findByRole("button", { name: "paper.applyMargin" });
  expect(mocks.applyPaper).not.toHaveBeenCalled();
  expect(mocks.setCorner).not.toHaveBeenCalled();
});

it("commits a complete bed dimension once instead of saving each keystroke", async () => {
  await setup();
  fireEvent.click(screen.getByText("paper.bedSize"));
  const input = screen.getByRole("spinbutton", { name: "paper.bedWidth" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.change(input, { target: { value: "2" } });
  fireEvent.change(input, { target: { value: "220" } });
  expect(mocks.saveCalibration).not.toHaveBeenCalled();
  fireEvent.blur(input);
  await waitFor(() => expect(mocks.saveCalibration).toHaveBeenCalledExactlyOnceWith({ bed_width: 220 }, "project"));
});


it("lets paper layout be edited before homing while keeping machine controls disabled", async () => {
  head = { ...head, homed: false, homed_axes: [] };
  render(<Paper status={{ configured: true, online: false }} onAction={vi.fn()} />);
  const corners = await screen.findByRole("button", { name: /paper.step3/ });
  expect(corners).toBeEnabled();
  fireEvent.click(corners);
  expect(screen.getByRole("button", { name: "calibration.captureCorner" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "paint.moreActions" }));
  expect(screen.getByRole("menuitem", { name: "paper.useCurrentArea" })).toBeEnabled();
  expect(mocks.home).not.toHaveBeenCalled();
  expect(mocks.move).not.toHaveBeenCalled();
});

it("does not advance the setup after homing finishes in a hidden view", async () => {
  let finish!: () => void;
  mocks.home.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const { rerender, onAction } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "paper.homeXYZ" }));
  expect(mocks.home).toHaveBeenCalledOnce();
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible={false} />);
  await act(async () => finish());
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} />);
  expect(screen.getByRole("button", { name: /paper.step1/ })).toHaveAttribute("aria-expanded", "true");
  expect(onAction).not.toHaveBeenCalled();
});

it("never starts a generated frame after leaving the calibration view", async () => {
  let finish!: (job: { filename: string }) => void;
  mocks.testPattern.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { rerender, onAction } = await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step5/ })); });
  const test = screen.getByRole("button", { name: "paper.testFrame" });
  fireEvent.click(test);
  fireEvent.click(test);
  expect(mocks.testPattern).toHaveBeenCalledExactlyOnceWith("frame", "project");
  expect(test).toBeDisabled();
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible={false} />);
  await act(async () => finish({ filename: "frame.gcode" }));
  expect(mocks.send).not.toHaveBeenCalled();
  expect(onAction).not.toHaveBeenCalled();
});

it.each([{ online: false }, { online: true, job: { state: "Printing" } }])(
  "does not start a generated frame when the printer becomes unavailable: %j", async status => {
    let finish!: (job: { filename: string }) => void;
    mocks.testPattern.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { rerender, onAction } = await setup();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step5/ })); });
    fireEvent.click(screen.getByRole("button", { name: "paper.testFrame" }));
    rerender(<Paper status={{ configured: true, ...status }} onAction={onAction} />);
    await act(async () => finish({ filename: "frame.gcode" }));
    expect(mocks.send).not.toHaveBeenCalled();
  },
);

it("discards an obstacle's first captured corner on tab changes", async () => {
  const { rerender, onAction } = await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step4Obstacles/ })); });
  fireEvent.click(screen.getByRole("button", { name: /paper.obsStartCapture/ }));
  fireEvent.click(screen.getByRole("button", { name: "paper.obsSetCorner1" }));
  expect(screen.getByRole("button", { name: "paper.obsSetCorner2" })).toBeInTheDocument();
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible={false} />);
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} />);
  expect(screen.getByRole("button", { name: /paper.obsStartCapture/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "paper.obsSetCorner2" })).not.toBeInTheDocument();
  expect(mocks.setObstacles).not.toHaveBeenCalled();
});

it("publishes a completed calibration save even if its view has since been hidden", async () => {
  let finish!: (calibration: Calibration) => void;
  mocks.saveCalibration.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { rerender, onAction } = await setup();
  fireEvent.click(screen.getByText("paper.bedSize"));
  const input = screen.getByRole("spinbutton", { name: "paper.bedWidth" });
  fireEvent.change(input, { target: { value: "230" } });
  fireEvent.blur(input);
  expect(mocks.saveCalibration).toHaveBeenCalledOnce();
  const reads = mocks.getProfile.mock.calls.length;
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible={false} />);
  profileCalibration = { ...profileCalibration, bed_width: 230 };
  await act(async () => finish(profileCalibration));
  await waitFor(() => expect(mocks.getProfile.mock.calls.length).toBeGreaterThan(reads));
  expect(onAction).not.toHaveBeenCalled();
});

it("uses a focused beginner flow without executing motion when changing steps", async () => {
  render(<Paper status={{configured:true,online:true}} onAction={vi.fn()} guided />);
  const pen=await screen.findByRole("button",{name:/paper.nav.pen/});
  fireEvent.click(pen);
  expect(await screen.findByText("calibration.penHint")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:/paper.step1$/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"paper.optionalTools"}));
  fireEvent.keyDown(document.activeElement!,{key:"ArrowDown"});
  expect(mocks.jog).not.toHaveBeenCalled();expect(mocks.home).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!,{key:"Escape"});
  expect(mocks.jog).not.toHaveBeenCalled();
});

it("shows paper arrows immediately, uses the selected step and captures the selected corner", async () => {
  render(<Paper status={{ configured: true, online: true }} onAction={vi.fn()} guided />);
  fireEvent.click(await screen.findByRole("button", { name: /paper.nav.corners/ }));
  const up = screen.getByRole("button", { name: "Y+" });
  await waitFor(() => expect(up).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  for (const [label, x, y] of [["Y+", 0, 1], ["X−", -1, 0], ["X+", 1, 0], ["Y−", 0, -1]] as const) {
    const button = screen.getByRole("button", { name: label });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(mocks.jog).toHaveBeenLastCalledWith(x, y, 0, { projectId: "project", pen_up_first: true }));
  }
  const capture = screen.getByRole("button", { name: "calibration.captureCorner" });
  await waitFor(() => expect(capture).toBeEnabled());
  fireEvent.change(screen.getByRole("combobox", { name: "calibration.corner" }), { target: { value: "br" } });
  fireEvent.click(capture);
  await waitFor(() => expect(mocks.setCorner).toHaveBeenCalledWith("br", "project", { mode: "manual", diagonal: "bl-tr" }));
  expect(mocks.home).not.toHaveBeenCalled();
});
it.each([
  { online: false, homed: true },
  { online: true, homed: false },
  { online: true, homed: true, job: { state: "Printing" } },
])("keeps visible paper arrows disabled when movement is unavailable: %j", async ({ homed, ...status }) => {
  head.homed = homed;
  render(<Paper status={{ configured: true, ...status }} onAction={vi.fn()} guided />);
  fireEvent.click(await screen.findByRole("button", { name: /paper.nav.corners/ }));
  for (const name of ["Y+", "X−", "X+", "Y−"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toBeDisabled(); fireEvent.click(button);
  }
  expect(mocks.jog).not.toHaveBeenCalled();
});

it("edits and moves the explicit visual profile instead of the current project's profile", async () => {
  mocks.getProfile.mockImplementation(async id => ({ id, name: id, active: true, archived: false, fingerprint: id, calibration: profileCalibration }));
  render(<Paper profileId="visual-profile" status={{ configured: true, online: true }} onAction={vi.fn()} guided />);
  const width = await screen.findByRole("spinbutton", { name: "paper.bedWidth" });
  await waitFor(() => expect(width).toBeEnabled());
  fireEvent.change(width, { target: { value: "240" } }); fireEvent.blur(width);
  await waitFor(() => expect(mocks.saveCalibration).toHaveBeenCalledWith({ bed_width: 240 }, { profileId: "visual-profile" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.homeXYZ" })).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.nav.corners/ })); });
  fireEvent.click(screen.getByRole("button", { name: "X+" }));
  await waitFor(() => expect(mocks.jog).toHaveBeenCalledWith(10, 0, 0, { profileId: "visual-profile", pen_up_first: true }));
  expect(mocks.activateProfile).not.toHaveBeenCalled();
});
it("edits and moves with the selected profile without global activation", async () => {
  mocks.getProfile.mockImplementation(async id => ({ id, name: id, active: false, archived: false, fingerprint: id, calibration: profileCalibration }));
  render(<Paper profileId="inactive-profile" status={{ configured: true, online: true }} onAction={vi.fn()} guided />);
  const width = await screen.findByRole("spinbutton", { name: "paper.bedWidth" });
  await waitFor(() => expect(width).toBeEnabled());
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.homeXYZ" })).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.nav.corners/ })); });
  await waitFor(() => expect(screen.getByRole("button", { name: "X+" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "X+" }));
  await waitFor(() => expect(mocks.jog).toHaveBeenCalledWith(10, 0, 0, { profileId: "inactive-profile", pen_up_first: true }));
  expect(mocks.activateProfile).not.toHaveBeenCalled();
});

it("discards a late visual-profile read after selecting another profile", async () => {
  let finish!: (profile: unknown) => void;
  const old = new Promise(resolve => { finish = resolve; });
  const newCal = { ...profileCalibration, bed_width: 270 };
  mocks.getProfile.mockImplementation(async id => id === "old-profile" ? old : ({ id, name: id, active: true, fingerprint: id === "project-profile" ? "project" : id, calibration: id === "new-profile" ? newCal : profileCalibration }));
  mocks.paper.mockImplementation(async target => ({ calibration: target?.profileId === "new-profile" ? newCal : profileCalibration, rect: [10, 10, 190, 190] }));
  const props = { status: { configured: true, online: true }, onAction: vi.fn(), guided: true };
  const view = render(<Paper {...props} profileId="old-profile" />);
  await waitFor(() => expect(mocks.getProfile).toHaveBeenCalledWith("old-profile", expect.any(AbortSignal)));
  view.rerender(<Paper {...props} profileId="new-profile" />);
  const width = await screen.findByRole("spinbutton", { name: "paper.bedWidth" });
  expect(width).toHaveValue(270);
  await act(async () => finish({ id: "old-profile", calibration: profileCalibration }));
  expect(width).toHaveValue(270);
  fireEvent.change(width, { target: { value: "280" } }); fireEvent.blur(width);
  await waitFor(() => expect(mocks.saveCalibration).toHaveBeenCalledWith({ bed_width: 280 }, { profileId: "new-profile" }));
});

it("previews an inactive profile on an old backend without using global paper data or sending commands", async () => {
  mocks.profileCalibration.mockRejectedValue(new ApiError("Not found", 404));
  mocks.getProfile.mockImplementation(async id => ({ id, name: id, active: false, fingerprint: id, calibration: { ...profileCalibration, bed_width: 321 } }));
  render(<Paper profileId="inactive-on-old-server" status={{ configured: true, online: true }} onAction={vi.fn()} guided />);
  const width = await screen.findByRole("spinbutton", { name: "paper.bedWidth" });
  expect(width).toHaveValue(321);
  expect(width).toBeDisabled();
  expect(screen.getByText("profiles.previewOnly")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(mocks.paper.mock.calls.some(([target]) => typeof target === "object")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "paper.homeXYZ" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.nav.corners/ })); });
  fireEvent.click(screen.getByRole("button", { name: "X+" }));
  expect(mocks.home).not.toHaveBeenCalled(); expect(mocks.jog).not.toHaveBeenCalled();
  expect(mocks.saveCalibration).not.toHaveBeenCalled(); expect(mocks.activateProfile).not.toHaveBeenCalled();
});

it("guides two diagonal captures, advances only after success, and labels generated corners", async () => {
  profileCalibration = { ...cal, paper_corners: {}, paper_diagonal: null };
  mocks.setCorner.mockImplementation(async () => {
    profileCalibration = { ...profileCalibration, paper_diagonal: "bl-tr",
      paper_corners: { bl: [20, 30], tr: [180, 190], tl: [20, 190], br: [180, 30] },
      paper_generated_corners: ["tl", "br"] };
    return { calibration: profileCalibration, rect: [20, 30, 160, 160] };
  });
  await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step3/ })); });
  fireEvent.click(screen.getByText("paper.cornerHelp"));
  expect(screen.getByText("paper.diagonalHint")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "calibration.corner" })).toHaveValue("bl");
  fireEvent.click(screen.getByRole("button", { name: "calibration.captureCorner" }));
  await waitFor(() => expect(mocks.setCorner).toHaveBeenCalledWith("bl", "project", { mode: "diagonal", diagonal: "bl-tr" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "calibration.corner" })).toHaveValue("tr"));
  expect(document.querySelectorAll(".calibration-corner-summary .generated")).toHaveLength(2);
  expect(screen.getByRole("img", { name: "paper.cornerTL · paper.cornerGenerated" }).querySelector("circle"))
    .toHaveAttribute("stroke-dasharray");
});

it("marks the current corner with one test-dot request and homes without changing steps or stored corners", async () => {
  await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step3/ })); });
  fireEvent.click(screen.getByRole("button", { name: "paper.testDot" }));
  await waitFor(() => expect(mocks.testDot).toHaveBeenCalledExactlyOnceWith("project"));
  expect(mocks.pen).not.toHaveBeenCalled();
  expect(mocks.setCorner).not.toHaveBeenCalled();
  const home = screen.getByRole("button", { name: "paper.rehome" });
  await waitFor(() => expect(home).toBeEnabled());
  fireEvent.click(home);
  await waitFor(() => expect(mocks.home).toHaveBeenCalledWith(undefined, "project"));
  expect(screen.getByRole("combobox", { name: "calibration.corner" })).toBeInTheDocument();
  expect(mocks.clearCorner).not.toHaveBeenCalled();
});

it("does not continue with a setup trip if its default-position save finishes after leaving the view", async () => {
  let finish!: (value: Calibration) => void;
  mocks.saveCalibration.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { rerender, onAction } = await setup();
  await openPositions();
  fireEvent.click(screen.getByRole("button", { name: "paper.preparePen →" }));
  await waitFor(() => expect(mocks.saveCalibration).toHaveBeenCalledOnce());
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible={false} />);
  await act(async () => finish(profileCalibration));
  expect(mocks.moveToPosition).not.toHaveBeenCalled();
});

it("starts the corner-point test beside the frame test with the displayed project's calibration", async () => {
  await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step5/ })); });
  expect(screen.getByRole("button", { name: "paper.testFrame" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "paper.testCorners" }));
  await waitFor(() => expect(mocks.testPattern).toHaveBeenCalledExactlyOnceWith("corners", "project"));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("frame.gcode", true));
});

it("does not start the corner-point test when its generating view has been left", async () => {
  let finish!: (job: { filename: string }) => void;
  mocks.testPattern.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { rerender, onAction } = await setup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step5/ })); });
  fireEvent.click(screen.getByRole("button", { name: "paper.testCorners" }));
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible={false} />);
  await act(async () => finish({ filename: "corners.gcode" }));
  expect(mocks.send).not.toHaveBeenCalled();
});

it("defaults to pen up on entry, step changes and reactivation without undoing explicit height adjustments", async () => {
  const { rerender, onAction } = await setup();
  await waitFor(() => expect(mocks.raisePen).toHaveBeenCalledWith("project"));
  const first = mocks.raisePen.mock.calls.length;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step3/ })); });
  await waitFor(() => expect(mocks.raisePen.mock.calls.length).toBeGreaterThan(first));
  const raised = mocks.raisePen.mock.calls.length;
  const jog = screen.getByRole("button", { name: "X+" });
  await waitFor(() => expect(jog).toBeEnabled());
  fireEvent.click(jog);
  await waitFor(() => expect(mocks.jog).toHaveBeenCalledWith(10, 0, 0, { projectId: "project", pen_up_first: true }));
  expect(mocks.raisePen).toHaveBeenCalledTimes(raised);
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible={false} />);
  rerender(<Paper status={{ configured: true, online: true }} onAction={onAction} visible />);
  await waitFor(() => expect(mocks.raisePen.mock.calls.length).toBeGreaterThan(raised));
});

it("leaves an explicitly lowered pen available for height adjustment and raises again when leaving that task", async () => {
  mocks.raisePen.mockImplementation(async () => {
    head = { ...head, z: Math.max(head.z, profileCalibration.pen_up_z) };
    return { ok: true, position: head };
  });
  await setup(); await openPositions();
  fireEvent.click(screen.getByRole("button", { name: "paper.preparePen →" }));
  const lower = await screen.findByRole("button", { name: "paper.testLower" });
  await waitFor(() => expect(lower).toBeEnabled());
  const raised = mocks.raisePen.mock.calls.length;
  await act(async () => { fireEvent.click(lower); });
  await waitFor(() => expect(mocks.pen).toHaveBeenCalledWith(true, "project"));
  expect(head.z).toBe(1);
  expect(mocks.raisePen).toHaveBeenCalledTimes(raised);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /paper.step3/ })); });
  await waitFor(() => expect(head.z).toBe(5));
});
