// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderComponent, screen, waitFor } from "@testing-library/react";
import { ProjectCalibrationProvider, useProjectCalibration } from "../../state/ProjectCalibrationContext";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import Calibrate from "./Calibrate";

const render = (ui: ReactElement) => renderComponent(ui, { wrapper: ({ children }) =>
  <ProjectCalibrationProvider active={false}>{children}</ProjectCalibrationProvider> });

const mocks = vi.hoisted(() => ({ listProfiles: vi.fn(), getProfile: vi.fn(), speedTest: vi.fn(),
  saveProfile: vi.fn(), confirm: vi.fn(), createProfile: vi.fn(), duplicateProfile: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../../api/events", () => ({ onAppEvent: () => () => {} }));
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../components/Toasts", () => ({ useToasts: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock("../../components/dialogs", () => ({ useConfirm: () => ({ confirm: mocks.confirm, ConfirmNode: null }) }));

vi.mock("./ProfileVisualEditor", () => ({ default: ({ profileId, visible }: { profileId: string; visible: boolean }) => <div data-testid="visual-profile" data-visible={visible}>{profileId}</div> }));
async function showDetails() { fireEvent.click(await screen.findByRole("button", { name: "profiles.details" })); }
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
  mocks.saveProfile.mockReset();
  mocks.createProfile.mockReset(); mocks.duplicateProfile.mockReset();
});

it("starts the pen-up movement test only with saved active settings", async () => {
  render(<Calibrate />);
  await showDetails();
  await screen.findByRole("spinbutton", { name: "calibrate.drawFeed" });
  const button = screen.getByRole("button", { name: "calibrate.speedTestButton" });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(mocks.speedTest).toHaveBeenCalledWith("active"));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("calibrate.speedTestSent"));

  fireEvent.change(screen.getByLabelText(/calibrate\.travelFeed/), { target: { value: "80" } });
  fireEvent.blur(screen.getByLabelText(/calibrate\.travelFeed/));
  expect((button as HTMLButtonElement).disabled).toBe(true);
});


it("respects cancelling the unsaved-changes dialog before creating or duplicating profiles", async () => {
  mocks.confirm.mockResolvedValue(false);
  render(<Calibrate />);
  await showDetails();
  const name = await screen.findByRole("textbox", { name: "profiles.name" });
  fireEvent.change(name, { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "profiles.new" }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
  expect(mocks.createProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "profiles.duplicate" }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
  expect(mocks.duplicateProfile).not.toHaveBeenCalled();
});


it("keeps invalid numeric edits out of saves and physical movement tests", async () => {
  render(<Calibrate />);
  await showDetails();
  const input = await screen.findByRole("spinbutton", { name: "calibrate.bedWidth" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));

  fireEvent.click(screen.getByRole("button", { name: "calibrate.speedTestButton" }));
  expect(mocks.saveProfile).not.toHaveBeenCalled();
  expect(mocks.speedTest).not.toHaveBeenCalled();
});

function ExternalChange() {
  const { profileChanged } = useProjectCalibration();
  return <button onClick={() => profileChanged("active")}>External profile update</button>;
}

it("preserves an unsaved profile draft when another view reports calibration changes", async () => {
  render(<><Calibrate /><ExternalChange /></>);
  await showDetails();
  const name = await screen.findByRole("textbox", { name: "profiles.name" });
  fireEvent.change(name, { target: { value: "My unsaved draft" } });
  const calls = mocks.getProfile.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "External profile update" }));
  expect((name as HTMLInputElement).value).toBe("My unsaved draft");
  expect(mocks.getProfile).toHaveBeenCalledTimes(calls);
});

it("refreshes a clean editor after another view reports calibration changes", async () => {
  render(<><Calibrate /><ExternalChange /></>);
  await showDetails();
  const name = await screen.findByRole("textbox", { name: "profiles.name" });
  const original = await mocks.getProfile.mock.results[0].value;
  mocks.getProfile.mockResolvedValue({ ...original, name: "Updated elsewhere" });
  fireEvent.click(screen.getByRole("button", { name: "External profile update" }));
  await waitFor(() => expect((name as HTMLInputElement).value).toBe("Updated elsewhere"));
});

it("does not replace edits made while an earlier save is still pending", async () => {
  render(<Calibrate />);
  await showDetails();
  const name = await screen.findByRole("textbox", { name: "profiles.name" });
  const original = await mocks.getProfile.mock.results[0].value;
  let resolve!: (profile: unknown) => void;
  mocks.saveProfile.mockReturnValue(new Promise(done => { resolve = done; }));
  fireEvent.change(name, { target: { value: "Saved draft" } });
  fireEvent.click(screen.getByRole("button", { name: /common.save/ }));
  await waitFor(() => expect(mocks.saveProfile).toHaveBeenCalledOnce());
  fireEvent.change(name, { target: { value: "Newer draft" } });
  resolve({ ...original, name: "Saved draft" });
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("profiles.saved"));
  expect((name as HTMLInputElement).value).toBe("Newer draft");
  expect((screen.getByRole("button", { name: /common.save/ }) as HTMLButtonElement).disabled).toBe(false);
});


it("keeps all groups visible and rejects invalid drafts before saving", async () => {
  render(<Calibrate />);
  await showDetails();
  const input = await screen.findByRole("spinbutton", { name: "calibrate.bedWidth" });
  fireEvent.change(input, { target: { value: "" } }); fireEvent.blur(input);
  expect(screen.getByRole("spinbutton", { name: "calibrate.penDownZ" })).toBeDefined();
  expect(screen.getByRole("spinbutton", { name: "calibrate.drawFeed" })).toBeDefined();
  expect(screen.getByRole("spinbutton", { name: "calibrate.originX" })).toBeDefined();
  expect(screen.getByRole("spinbutton", { name: "calibrate.bedWidth" })).toBe(input);
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  expect(mocks.saveProfile).not.toHaveBeenCalled();
  expect(screen.getByRole("spinbutton", { name: "calibrate.bedWidth" })).toBe(input);
  expect((input as HTMLInputElement).value).toBe("");
});

it("opens the visual editor by default and switches to details of the same profile", async () => {
  render(<Calibrate />);
  expect(await screen.findByTestId("visual-profile")).toHaveTextContent("active");
  expect(screen.getByRole("button", { name: "profiles.visual" })).toHaveAttribute("aria-pressed", "true");
  await showDetails();
  expect(await screen.findByRole("textbox", { name: "profiles.name" })).toHaveValue("Standard");
  fireEvent.click(screen.getByRole("button", { name: "profiles.visual" }));
  expect(await screen.findByTestId("visual-profile")).toHaveTextContent("active");
});
it("keeps unsaved details until the user agrees to save before switching views", async () => {
  render(<Calibrate />); await showDetails();
  const input = await screen.findByRole("textbox", { name: "profiles.name" });
  fireEvent.change(input, { target: { value: "Edited" } });
  mocks.confirm.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "profiles.visual" }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith("profiles.saveBeforeVisual"));
  expect(input).toHaveValue("Edited"); expect(mocks.saveProfile).not.toHaveBeenCalled();
  const original = await mocks.getProfile.mock.results[0].value;
  mocks.saveProfile.mockImplementation(async () => { const saved = { ...original, name: "Edited" }; mocks.getProfile.mockResolvedValue(saved); return saved; });
  fireEvent.click(screen.getByRole("button", { name: "profiles.visual" }));
  expect(await screen.findByTestId("visual-profile")).toHaveTextContent("active");
  expect(mocks.saveProfile).toHaveBeenCalledWith("active", expect.objectContaining({ name: "Edited" }));
});
it("opens a requested setup profile in the visual view even after visiting Details", async () => {
  const base = (await mocks.listProfiles())[0];
  const original = await mocks.getProfile();
  mocks.listProfiles.mockResolvedValue([base, { ...base, id: "project-profile", name: "Project profile", active: false }]);
  mocks.getProfile.mockImplementation(async id => ({ ...original, id, name: id === "active" ? "Standard" : "Project profile" }));
  const view = render(<Calibrate />); await showDetails();
  await screen.findByRole("textbox", { name: "profiles.name" });
  view.rerender(<Calibrate request={{ id: "project-profile", nonce: 1 }} />);
  await waitFor(() => expect(screen.getByTestId("visual-profile")).toHaveTextContent("project-profile"));
  expect(screen.getByRole("button", { name: "profiles.visual" })).toHaveAttribute("aria-pressed", "true");
});
it("does not switch to manual control while a movement test is pending", async () => {
  let finish!: () => void;
  mocks.speedTest.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  render(<Calibrate />); await showDetails();
  fireEvent.click(await screen.findByRole("button", { name: "calibrate.speedTestButton" }));
  expect(screen.getByRole("button", { name: "profiles.visual" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "profiles.new" })).toBeDisabled();
  finish();
  await waitFor(() => expect(screen.getByRole("button", { name: "profiles.visual" })).toBeEnabled());
});
