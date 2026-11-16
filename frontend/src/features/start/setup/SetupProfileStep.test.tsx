// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SetupProfileStep from "./SetupProfileStep";
import type { CalibrationProfile, PageIndex } from "../../../api";
const mocks = vi.hoisted(() => ({
  createProfile: vi.fn(),
  saveProfile: vi.fn(),
  createProject: vi.fn(),
  flush: vi.fn(),
}));
vi.mock("../../../api", () => ({ api: mocks }));
vi.mock("../../../api/pageEdits", () => ({ flushEdits: mocks.flush }));
vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const profile = {
  id: "old",
  name: "Existing",
  calibration: { bed_width: 210, bed_height: 210 },
} as CalibrationProfile;
const index = {
  activeId: "page",
  order: [],
  project: { id: "old-project", profileId: "old" },
} as unknown as PageIndex;
function setup() {
  const onCreated = vi.fn();
  render(
    <SetupProfileStep
      index={index}
      profile={profile}
      active
      locked={false}
      onUse={vi.fn()}
      onCreated={onCreated}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "setup.createNew" }));
  fireEvent.click(screen.getByRole("checkbox"));
  return onCreated;
}
it("creates a fresh uncalibrated profile and binds its ID to the new project", async () => {
  mocks.createProfile.mockResolvedValue({ id: "new-profile" });
  mocks.createProject.mockResolvedValue({ project: { id: "new-project" } });
  const onCreated = setup();
  fireEvent.click(
    screen.getByRole("button", { name: "setup.createProfileProject" }),
  );
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  expect(mocks.flush).toHaveBeenCalledWith("page");
  expect(mocks.createProfile).toHaveBeenCalledWith(
    "setup.defaultProfile",
    expect.objectContaining({
      pen_calibrated: false,
      paper_corners: {},
      pen_pressure_max_depth: 0,
      defined_positions: [],
    }),
  );
  expect(mocks.createProject).toHaveBeenCalledWith(
    "setup.defaultProject",
    undefined,
    "new-profile",
  );
});
it("retries a partial failure without duplicating the created profile", async () => {
  mocks.createProfile.mockResolvedValue({ id: "new-profile" });
  mocks.saveProfile.mockResolvedValue({ id: "new-profile" });
  mocks.createProject
    .mockRejectedValueOnce(new Error("Project save failed"))
    .mockResolvedValueOnce({ project: { id: "new-project" } });
  const onCreated = setup();
  fireEvent.click(
    screen.getByRole("button", { name: "setup.createProfileProject" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "setup.createProfileProject" }),
  );
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  expect(mocks.createProfile).toHaveBeenCalledOnce();
  expect(mocks.saveProfile).toHaveBeenCalledOnce();
});
