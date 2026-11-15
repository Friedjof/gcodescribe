// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Paper from "./Paper";
import type { Calibration, Position, PositionKind } from "../../api";

const mocks = vi.hoisted(() => ({
  paper: vi.fn(), position: vi.fn(), activeProfile: vi.fn(), listJobs: vi.fn(),
  listPages: vi.fn(), activateProfile: vi.fn(), saveProfile: vi.fn(), getProfile: vi.fn(),
  move: vi.fn(), moveToPosition: vi.fn(), positionFromHead: vi.fn(), pen: vi.fn(),
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
    fingerprint: "project", calibration: profileCalibration }));
  mocks.listPages.mockResolvedValue({ project: { id: "project", name: "Project", profileId: "project-profile" },
    activeProfile: { id: "project-profile", name: "Project profile", fingerprint: "project",
      plot_width: 200, plot_height: 200, origin_x: 5, origin_y: 5 } });
  mocks.activateProfile.mockImplementation(async (id) => ({ id, name: "Project", calibration: profileCalibration }));
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
  mocks.moveToPosition.mockImplementation(async (kind, target) => {
    head = { ...head, ...(target ?? { x: 105, y: kind === "park" ? 210 : 105 }), z: kind === "park" ? 10 : 1 };
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
  mocks.pen.mockImplementation(async (down) => {
    head = { ...head, z: down ? 1 : 5 };
    return { ok: true, z: head.z, position: head };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function setup(status = { online: true }) {
  const onAction = vi.fn();
  const view = render(<Paper status={status} onAction={onAction} />);
  await screen.findByRole("button", { name: /paper.positions.title/ });
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.clickMove" })).toBeEnabled());
  const svg = view.container.querySelector("svg")!;
  Object.defineProperty(svg, "createSVGPoint", { value: () => ({
    x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; },
  }) });
  Object.defineProperty(svg, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
  return { ...view, svg, onAction };
}

it("uses the project's complete calibration even when the global profile differs", async () => {
  mocks.listPages.mockResolvedValue({ project: { id: "project", name: "Formelsammlungen", profileId: "project-profile" },
    activeProfile: { id: "project-profile", name: "Formelsammlungen – Profil",
      fingerprint: "project", plot_width: 166, plot_height: 205, origin_x: 1, origin_y: 4 } });
  profileCalibration = { ...cal, origin_x: 25, plot_width: 140, pen_down_z: 2 };
  await setup();
  expect(screen.getByText('paper.context Formelsammlungen Project profile')).toBeInTheDocument();
  expect(mocks.getProfile).toHaveBeenCalledWith("project-profile");
  expect(mocks.paper).toHaveBeenCalledWith("project");
  expect(mocks.activeProfile).not.toHaveBeenCalled();
  expect(screen.queryByRole("img", { name: "A5 148 × 210 mm" })).not.toBeInTheDocument();
  expect(mocks.activateProfile).not.toHaveBeenCalled();
  expect(mocks.paper).toHaveBeenCalledOnce();
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

function openPositions() { fireEvent.click(screen.getByRole("button", { name: /paper.positions.title/ })); }
function targetClick(svg: SVGSVGElement) { fireEvent.click(svg, { clientX: 40, clientY: 180 }); }

it("keeps four main steps before optional settings and requires explicit click-to-move", async () => {
  const { container, svg } = await setup();
  const steps = Array.from(container.querySelectorAll(".wstep-title")).map((el) => el.textContent);
  expect(steps).toEqual(["paper.step1", "paper.step2", "paper.step3", "paper.step5", "paper.positions.title", "paper.step4Obstacles"]);
  expect(container.querySelector("section")?.querySelector(".wizard")).not.toBeNull();
  const toggle = screen.getByRole("button", { name: "paper.clickMove" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  targetClick(svg);
  expect(mocks.move).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  openPositions();
  expect(toggle).toBeDisabled();
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByText("paper.editPositions")).not.toBeInTheDocument();
  openPositions();
  expect(toggle).toBeEnabled();
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  targetClick(svg);
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith(40, 30, "project"));
  expect(mocks.moveToPosition).not.toHaveBeenCalled();
});

it.each(["P", "C"])("positions %s directly on the board without saving, then explicitly captures it", async (marker) => {
  const { svg } = await setup();
  const kind = marker === "P" ? "park" : "calibration";
  openPositions();
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${marker} `) }));
  expect(mocks.moveToPosition).not.toHaveBeenCalled();
  targetClick(svg);
  await waitFor(() => expect(screen.getByRole("button", { name: `paper.positions.capture ${marker}` })).toBeEnabled());
  expect(mocks.moveToPosition).toHaveBeenLastCalledWith(kind, { x: 40, y: 30 }, "project");
  expect(mocks.move).not.toHaveBeenCalled();
  expect(mocks.saveCalibration).not.toHaveBeenCalled();
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
  expect(screen.getByRole("img", { name: `${marker} · paper.positions.target` })).toBeInTheDocument();
  fireEvent.click(svg, { clientX: 50, clientY: 180 });
  await waitFor(() => expect(mocks.moveToPosition).toHaveBeenLastCalledWith(kind, { x: 50, y: 30 }, "project"));
  await waitFor(() => expect(screen.getByRole("button", { name: `paper.positions.capture ${marker}` })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: `paper.positions.capture ${marker}` }));
  await waitFor(() => expect(mocks.positionFromHead).toHaveBeenCalledWith(kind, "project"));
  await waitFor(() => expect(screen.queryByRole("img", { name: `${marker} · paper.positions.target` })).not.toBeInTheDocument());
});

it("shows three coordinate columns and uses the board without extra movement controls", async () => {
  const { container } = await setup();
  openPositions();
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
  openPositions();
  targetClick(svg);
  expect(screen.getByRole("button", { name: /^C / })).toBeDisabled();
  expect(screen.getByRole("button", { name: "paper.positions.capture P" })).toBeDisabled();
  targetClick(svg);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(mocks.moveToPosition).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("offline")));
  expect(mocks.error).toHaveBeenCalledWith("offline");
  expect(screen.queryByRole("img", { name: "P · paper.positions.target" })).not.toBeInTheDocument();
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
});

it.each([{ online: false }, { online: true, motion_locked: true }, { online: true, job: { state: "Printing" } }])(
  "blocks clicks, jogs, and capturing when unavailable: %j", async (status) => {
    const { svg } = await setup(status);
    openPositions();
    targetClick(svg);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "paper.positions.capture P" })).toBeDisabled();
    expect(mocks.moveToPosition).not.toHaveBeenCalled();
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.positionFromHead).not.toHaveBeenCalled();
  }
);

it("discards targets on tab changes and keeps the user's click-to-move preference", async () => {
  const { svg, rerender, onAction } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "paper.clickMove" }));
  openPositions();
  targetClick(svg);
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.positions.capture P" })).toBeEnabled());
  rerender(<Paper status={{ online: true }} onAction={onAction} visible={false} />);
  rerender(<Paper status={{ online: true }} onAction={onAction} visible={true} />);
  await screen.findByRole("button", { name: /paper.positions.title/ });
  expect(screen.getByRole("button", { name: /paper.positions.title/ })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: "paper.clickMove" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("img", { name: "P · paper.positions.target" })).not.toBeInTheDocument();
});

it("keeps special positions readable but blocks motion and capture before homing", async () => {
  head = { ...head, homed: false, homed_axes: [] };
  const { container } = render(<Paper status={{ online: true }} onAction={vi.fn()} />);
  await screen.findByRole("button", { name: /paper.positions.title/ });
  openPositions();
  expect(screen.getByText("paper.positions.stored")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "paper.positions.capture P" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "common.next →" })).toBeDisabled();
  fireEvent.click(container.querySelector("svg")!, { clientX: 40, clientY: 180 });
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(mocks.moveToPosition).not.toHaveBeenCalled();
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
});

it.each<{ defined: PositionKind[] }>([{ defined: [] }, { defined: ["park"] }])("does not complete step 3 with only $defined defined", async ({ defined }) => {
  profileCalibration = { ...cal, defined_positions: defined };
  await setup();
  openPositions();
  fireEvent.click(screen.getByRole("button", { name: "common.next →" }));
  expect(screen.getByRole("button", { name: /paper.positions.title/ }).querySelector(".badge"))
    .not.toHaveClass("done");
});

it("completes step 3 only after both positions are saved and Next is clicked", async () => {
  const { svg } = await setup();
  const step = screen.getByRole("button", { name: /paper.positions.title/ });
  openPositions();
  for (const marker of ["P", "C"]) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${marker} `) }));
    targetClick(svg);
    const capture = screen.getByRole("button", { name: `paper.positions.capture ${marker}` });
    await waitFor(() => expect(capture).toBeEnabled());
    fireEvent.click(capture);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(`paper.positions.saved ${marker}`));
  }
  expect(step.querySelector(".badge")).not.toHaveClass("done");
  fireEvent.click(screen.getByRole("button", { name: "common.next →" }));
  expect(step.querySelector(".badge")).toHaveClass("done");
  expect(step.querySelector(".badge")).toHaveTextContent("✓");
  openPositions();
  expect(step.querySelector(".badge")).toHaveClass("done");
  fireEvent.click(svg, { clientX: 60, clientY: 180 });
  const capture = screen.getByRole("button", { name: "paper.positions.capture C" });
  await waitFor(() => expect(capture).toBeEnabled());
  fireEvent.click(capture);
  await waitFor(() => expect(step.querySelector(".badge")).not.toHaveClass("done"));
});

it("accepts previously defined positions on Next without carrying completion to another profile", async () => {
  profileCalibration = { ...cal, defined_positions: ["park", "calibration"] };
  await setup();
  const step = screen.getByRole("button", { name: /paper.positions.title/ });
  openPositions();
  fireEvent.click(screen.getByRole("button", { name: "common.next →" }));
  expect(step.querySelector(".badge")).toHaveClass("done");
  mocks.listPages.mockResolvedValue({ project: { id: "other-project", name: "Other", profileId: "other" },
    activeProfile: { id: "other", fingerprint: "other" } });
  await waitFor(() => expect(step.querySelector(".badge")).not.toHaveClass("done"), { timeout: 3000 });
});

it("clears the target when the active profile changes while the step remains open", async () => {
  const { svg } = await setup();
  openPositions();
  targetClick(svg);
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.positions.capture P" })).toBeEnabled());
  expect(screen.getByRole("img", { name: "P · paper.positions.target" })).toBeInTheDocument();
  mocks.listPages.mockResolvedValue({ project: { id: "other-project", name: "Other", profileId: "other" },
    activeProfile: { id: "other", fingerprint: "other" } });
  await waitFor(() => expect(screen.queryByRole("img", { name: "P · paper.positions.target" })).not.toBeInTheDocument(), { timeout: 3000 });
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
});

it.each(["P", "C"])("explicitly homes then visits saved %s, including before homing", async (marker) => {
  head = { ...head, homed: false, homed_axes: [] };
  render(<Paper status={{ online: true }} onAction={vi.fn()} />);
  await screen.findByRole("button", { name: /paper.positions.title/ });
  openPositions();
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${marker} `) }));
  const visit = screen.getByRole("button", { name: `paper.positions.homeVisit ${marker}` });
  expect(visit).toHaveAttribute("title", `paper.positions.homeHint ${marker}`);
  await waitFor(() => expect(visit).toBeEnabled());
  fireEvent.click(visit);
  await waitFor(() => expect(mocks.homeAndMoveToPosition).toHaveBeenCalledWith(marker === "P" ? "park" : "calibration", "project"));
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
  fireEvent.click(screen.getByRole("button", { name: /paper.step3/ }));
  fireEvent.click(screen.getByText("paper.manualCapture"));
  const capture = screen.getByRole("button", { name: "paper.cornerBL" });
  fireEvent.click(capture);
  await waitFor(() => expect(mocks.setCorner).toHaveBeenCalledWith("bl", "project"));
  fireEvent.click(capture.closest(".corner")!.querySelector('button[title="paper.driveCorner"]')!);
  await waitFor(() => expect(mocks.moveToCorner).toHaveBeenCalledWith("bl", "paper", "project"));
  fireEvent.click(screen.getByRole("button", { name: /paper.step5/ }));
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
  openPositions();
  fireEvent.click(screen.getByRole("button", { name: /^C / }));
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
  fireEvent.click(screen.getByRole("button", { name: /paper.step5/ }));
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
  fireEvent.click(step);
  expect(screen.getByRole("button", { name: "paper.applyMargin" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "paper.fromCorners" })).toBeDisabled();
});


it("follows the main setup path without requiring custom positions or obstacles", async () => {
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "paper.continueSetup" }));
  fireEvent.click(screen.getByRole("button", { name: "paper.toCorners" }));
  fireEvent.click(screen.getByRole("button", { name: "paper.usePaperArea" }));
  await waitFor(() => expect(mocks.applyPaper).toHaveBeenCalledWith(0, "project", true));
  await screen.findByRole("button", { name: "paper.applyMargin" });
  expect(mocks.positionFromHead).not.toHaveBeenCalled();
  expect(mocks.setObstacles).not.toHaveBeenCalled();
});

it("can keep the current plot area without capturing paper corners", async () => {
  mocks.paper.mockResolvedValue({ calibration: { ...profileCalibration, paper_corners: {} }, rect: null });
  await setup();
  fireEvent.click(screen.getByRole("button", { name: /paper.step3/ }));
  expect(screen.getByRole("button", { name: "paper.usePaperArea" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "paper.useCurrentArea" }));
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
  render(<Paper status={{ online: false }} onAction={vi.fn()} />);
  const corners = await screen.findByRole("button", { name: /paper.step3/ });
  expect(corners).toBeEnabled();
  fireEvent.click(corners);
  fireEvent.click(screen.getByText("paper.manualCapture"));
  expect(screen.getByRole("button", { name: "paper.cornerBL" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "paper.useCurrentArea" })).toBeEnabled();
  expect(mocks.home).not.toHaveBeenCalled();
  expect(mocks.move).not.toHaveBeenCalled();
});
