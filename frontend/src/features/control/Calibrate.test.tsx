// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Calibrate from "./Calibrate";

const mocks = vi.hoisted(() => ({ listProfiles: vi.fn(), getProfile: vi.fn(), speedTest: vi.fn(),
  confirm: vi.fn(), createProfile: vi.fn(), duplicateProfile: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../components/Toasts", () => ({ useToasts: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock("../../components/dialogs", () => ({ useConfirm: () => ({ confirm: mocks.confirm, ConfirmNode: null }) }));

afterEach(cleanup);

beforeEach(() => {
  mocks.listProfiles.mockReset().mockResolvedValue([{ id: "active", name: "Standard", active: true,
    archived: false, plot_width: 100, plot_height: 100, origin_x: 0, origin_y: 0,
    paper_margin: 0, pen_calibrated: true }]);
  mocks.getProfile.mockReset().mockResolvedValue({ id: "active", name: "Standard", calibration: {
    bed_width: 200, bed_height: 200, z_max: 200, plot_width: 100, plot_height: 100,
    origin_x: 0, origin_y: 0, pen_up_z: 5, pen_down_z: 1, travel_feed: 100,
    draw_feed: 50, z_feed: 20, z_max_feedrate: 60, merge_tolerance: 0.5,
    park_x: 100, park_y: 200, park_lift_z: 5, calibration_x: 100, calibration_y: 100,
  } });
  mocks.speedTest.mockReset().mockResolvedValue({ ok: true, size: 88 });
  mocks.success.mockReset(); mocks.error.mockReset();
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.createProfile.mockReset(); mocks.duplicateProfile.mockReset();
});

it("starts the pen-up movement test only with saved active settings", async () => {
  render(<Calibrate />);
  const button = await screen.findByRole("button", { name: "calibrate.speedTestButton" });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(mocks.speedTest).toHaveBeenCalledWith("active"));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("calibrate.speedTestSent"));

  fireEvent.change(screen.getByLabelText(/calibrate\.travelFeed/), { target: { value: "80" } });
  expect((button as HTMLButtonElement).disabled).toBe(true);
});


it("respects cancelling the unsaved-changes dialog before creating or duplicating profiles", async () => {
  mocks.confirm.mockResolvedValue(false);
  render(<Calibrate />);
  const name = await screen.findByRole("textbox", { name: "profiles.name" });
  fireEvent.change(name, { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "profiles.new" }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
  expect(mocks.createProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "profiles.duplicate" }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
  expect(mocks.duplicateProfile).not.toHaveBeenCalled();
});
