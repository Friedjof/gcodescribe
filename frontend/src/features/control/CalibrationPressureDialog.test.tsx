// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CalibrationPressureDialog from "./CalibrationPressureDialog";

const mocks = vi.hoisted(() => ({
  activeProfile: vi.fn(), position: vi.fn(), saveProfile: vi.fn(),
  calibrationHeight: vi.fn(), homeAndMoveToPosition: vi.fn(), error: vi.fn(), success: vi.fn(),
}));
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({
  t: (key: string, vars?: Record<string, string>) => key + (vars?.z ? ` ${vars.z}` : vars?.marker ? ` ${vars.marker}` : ""),
}) }));
vi.mock("../../components/Toasts", () => ({ useToasts: () => ({ error: mocks.error, success: mocks.success }) }));
const initial = { id: "active", name: "Current printer profile", calibration: {
  calibration_x: 40, calibration_y: 60, calibration_pressure_offset: 0,
  pen_down_z: 1, pen_up_z: 5, z_max: 205,
} };
let profile = initial;
let head = { x: 40, y: 60, z: 1, homed: true, homed_axes: ["x", "y", "z"] };
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  profile = { ...initial, calibration: { ...initial.calibration } };
  head = { ...head, x: 40, y: 60, z: 1, homed: true };
  mocks.activeProfile.mockImplementation(async () => profile);
  mocks.position.mockImplementation(async () => head);
  mocks.saveProfile.mockImplementation(async (_, updates) => {
    profile = { ...profile, calibration: { ...profile.calibration, ...updates.calibration } };
    return profile;
  });
  mocks.calibrationHeight.mockImplementation(async (_, offset) => ({ position: { ...head, z: Math.max(0, 1 + offset) } }));
  mocks.homeAndMoveToPosition.mockResolvedValue({ position: head });
});
afterEach(cleanup);
async function setup(canMove = true) {
  const onPosition = vi.fn();
  const onCalibration = vi.fn();
  render(<CalibrationPressureDialog canMove={canMove} onClose={vi.fn()} onBusyChange={vi.fn()}
    onPosition={onPosition} onCalibration={onCalibration} />);
  await screen.findByRole("spinbutton");
  return { onPosition, onCalibration };
}

it("editing or saving the offset does not move, and saves only the active profile offset", async () => {
  const { onCalibration } = await setup();
  fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
  expect(screen.getByText("paper.pressure.height 2.00")).toBeInTheDocument();
  expect(mocks.saveProfile).not.toHaveBeenCalled();
  expect(mocks.calibrationHeight).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  await waitFor(() => expect(onCalibration).toHaveBeenCalled());
  expect(mocks.saveProfile).toHaveBeenCalledWith("active", { calibration: { calibration_pressure_offset: 1 } });
  expect(mocks.calibrationHeight).not.toHaveBeenCalled();
  expect(mocks.homeAndMoveToPosition).not.toHaveBeenCalled();
  expect(profile.calibration.pen_down_z).toBe(1);
});

it.each([[-3, "0.00"], [1, "2.00"], [3, "4.00"]])("applies %s mm only on explicit action, with a floor of zero", async (offset, height) => {
  const { onPosition } = await setup();
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: String(offset) } });
  expect(screen.getByText(`paper.pressure.height ${height}`)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "paper.pressure.apply" }));
  await waitFor(() => expect(mocks.calibrationHeight).toHaveBeenCalledWith("active", offset));
  await waitFor(() => expect(onPosition).toHaveBeenCalledWith(expect.objectContaining({ z: Number(height) })));
});

it.each(["-4", "4", ""])("blocks out-of-range or empty input: %s", async (value) => {
  await setup();
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value } });
  expect(screen.getByRole("button", { name: "paper.pressure.apply" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  expect(mocks.calibrationHeight).not.toHaveBeenCalled();
});

it("requires C first and labels the homing trip explicitly", async () => {
  head = { ...head, x: 10, y: 20, homed: false };
  mocks.homeAndMoveToPosition.mockResolvedValue({ position: { ...head, x: 40, y: 60, homed: true } });
  await setup();
  expect(screen.getByRole("button", { name: "paper.pressure.apply" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "paper.positions.homeVisit C" }));
  await waitFor(() => expect(mocks.homeAndMoveToPosition).toHaveBeenCalledWith("calibration"));
  await waitFor(() => expect(screen.getByRole("button", { name: "paper.pressure.apply" })).toBeEnabled());
  expect(mocks.calibrationHeight).not.toHaveBeenCalled();
});

it("blocks movement when unavailable but allows saving the preference", async () => {
  await setup(false);
  expect(screen.getByRole("button", { name: "paper.pressure.apply" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled();
});

it("rejects a profile switch before saving or moving", async () => {
  await setup();
  profile = { ...profile, id: "new-profile" };
  fireEvent.click(screen.getByRole("button", { name: "paper.pressure.apply" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("paper.pressure.profileChanged"));
  expect(mocks.calibrationHeight).not.toHaveBeenCalled();
  expect(mocks.saveProfile).not.toHaveBeenCalled();
});
