// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TourProvider, { useAppTour } from "./TourProvider";
import { TOUR_STORAGE_KEY, TOUR_STEPS } from "./tourModel";
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), confirmed: false }));
const t = (key: string) => key;
vi.mock("../../i18n", () => ({ useI18n: () => ({ t }) }));
vi.mock("../../state/ProjectCalibrationContext", () => ({
  useProjectCalibration: () => ({
    index: { project: { id: "project" } },
    profile: { id: "profile" },
  }),
}));
vi.mock("../start/setup/useSetupProgress", () => ({
  useSetupProgress: () => ({ progress: { confirmed: mocks.confirmed } }),
}));
beforeEach(() => {
  localStorage.clear();
  mocks.navigate.mockReset();
  mocks.confirmed = false;
});
afterEach(cleanup);
function Actions() {
  const tour = useAppTour();
  return (
    <>
      <button onClick={() => tour?.offer()}>Offer tour</button>
      <button onClick={() => tour?.followSetup("connection")}>
        Confirm profile
      </button>
      <button onClick={() => tour?.followCalibration("pen")}>
        App pen step
      </button>
      <span data-testid="step">{tour?.step?.id}</span>
      <div data-tour="setup-profile-choice">Profile choices</div>
      <div data-tour="setup-connection">Connection</div>
    </>
  );
}
function show(blocked = false, printerBusy = false) {
  return render(
    <TourProvider
      onNavigate={mocks.navigate}
      blocked={blocked}
      printerBusy={printerBusy}
    >
      <Actions />
    </TourProvider>,
  );
}
it("offers first-time guidance once and remembers a dismissal across restarts", () => {
  const first = show();
  fireEvent.click(screen.getByRole("button", { name: "tour.later" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY)!).state).toBe(
    "dismissed",
  );
  first.unmount();
  show();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Offer tour" }));
  expect(screen.getByRole("dialog")).toBeDefined();
});
it("moves between real workspaces, follows setup actions and remembers completion without marking setup complete", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "tour.start" }));
  expect(mocks.navigate).toHaveBeenLastCalledWith("paper");
  fireEvent.click(screen.getByRole("button", { name: "Confirm profile" }));
  expect(screen.getByTestId("step").textContent).toBe("connection");
  fireEvent.click(screen.getByRole("button", { name: "tour.back" }));
  expect(screen.getByTestId("step").textContent).toBe("profile");
  for (let i = 0; i < TOUR_STEPS.length - 1; i++)
    fireEvent.click(screen.getByRole("button", { name: "tour.next" }));
  expect(mocks.navigate).toHaveBeenCalledWith("paint");
  expect(mocks.navigate).toHaveBeenLastCalledWith("games");
  fireEvent.click(screen.getByRole("button", { name: "tour.finish" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY)!).state).toBe(
    "finished",
  );
  expect(mocks.confirmed).toBe(false);
});
it("pauses around settings and printer activity, then restores the current step", () => {
  const view = show(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(
    <TourProvider onNavigate={mocks.navigate} blocked={false}>
      <Actions />
    </TourProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "tour.start" }));
  view.rerender(
    <TourProvider onNavigate={mocks.navigate} blocked={true}>
      <Actions />
    </TourProvider>,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(
    <TourProvider onNavigate={mocks.navigate} blocked={false} printerBusy>
      <Actions />
    </TourProvider>,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(
    <TourProvider onNavigate={mocks.navigate} blocked={false}>
      <Actions />
    </TourProvider>,
  );
  expect(
    screen.getByRole("heading", { name: "tour.profile.title" }),
  ).toBeDefined();
});
it("minimizes on Escape and restores without losing the current step", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "tour.start" }));
  fireEvent.click(screen.getByRole("button", { name: "tour.next" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "tour.minimized" }));
  expect(
    screen.getByRole("heading", { name: "tour.connection.title" }),
  ).toBeDefined();
});

it("minimizes when the user visits another area and deliberately returns on resume", () => {
  const view = render(
    <TourProvider
      activeWorkspace="paper"
      onNavigate={mocks.navigate}
      blocked={false}
    >
      <Actions />
    </TourProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "tour.start" }));
  view.rerender(
    <TourProvider
      activeWorkspace="convert"
      onNavigate={mocks.navigate}
      blocked={false}
    >
      <Actions />
    </TourProvider>,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  mocks.navigate.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "tour.minimized" }));
  expect(mocks.navigate).toHaveBeenCalledWith("paper");
});
it("offers an unfinished tour at its saved step after a restart", () => {
  localStorage.setItem(
    TOUR_STORAGE_KEY,
    JSON.stringify({ version: 1, state: "progress", step: 6 }),
  );
  show();
  fireEvent.click(screen.getByRole("button", { name: "tour.resume" }));
  expect(screen.getByTestId("step").textContent).toBe("drawing");
});

it("replays a completed tour from the beginning when opened again from Help", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "tour.start" }));
  for (let i = 0; i < TOUR_STEPS.length - 1; i++)
    fireEvent.click(screen.getByRole("button", { name: "tour.next" }));
  fireEvent.click(screen.getByRole("button", { name: "tour.finish" }));
  fireEvent.click(screen.getByRole("button", { name: "Offer tour" }));
  fireEvent.click(screen.getByRole("button", { name: "tour.start" }));
  expect(screen.getByTestId("step").textContent).toBe("profile");
});
