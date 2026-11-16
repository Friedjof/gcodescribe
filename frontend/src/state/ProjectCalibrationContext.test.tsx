// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppEvent } from "../api/events";
import { ProjectCalibrationProvider, useProjectCalibration } from "./ProjectCalibrationContext";

const mocks = vi.hoisted(() => ({ listPages: vi.fn(), getProfile: vi.fn(), paper: vi.fn(),
  subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("../api", () => ({ api: mocks }));
vi.mock("../api/events", () => ({ onAppEvent: mocks.subscribe }));
let event: (event: AppEvent) => void;
const index = (id = "a") => ({ project: { id, profileId: `profile-${id}` }, order: [], activeId: null,
  activeProfile: { id: `profile-${id}`, name: id, fingerprint: id } });
const profile = (id: string) => ({ id: `profile-${id}`, name: id, fingerprint: id,
  calibration: { bed_width: id === "a" ? 210 : 300 } });
function Consumer({ id }: { id: string }) {
  const snapshot = useProjectCalibration();
  return <output data-testid={id}>{snapshot.index?.project?.id}:{snapshot.profile?.calibration.bed_width}:{snapshot.agentRevision}</output>;
}
function App({ active = true }: { active?: boolean }) {
  return <ProjectCalibrationProvider active={active}><Consumer id="designer" /><Consumer id="calibration" /></ProjectCalibrationProvider>;
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.listPages.mockResolvedValue(index());
  mocks.getProfile.mockImplementation(async id => profile(id.slice("profile-".length)));
  mocks.paper.mockImplementation(async id => ({ calibration: profile(id).calibration, rect: null }));
  mocks.subscribe.mockImplementation(listener => { event = listener; return mocks.unsubscribe; });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shares one read/poll between views and cleans up the timer and subscription", async () => {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<App />); });
  expect(screen.getByTestId("designer").textContent).toBe("a:210:0");
  expect(screen.getByTestId("calibration").textContent).toBe("a:210:0");
  expect(mocks.listPages).toHaveBeenCalledTimes(1);
  expect(mocks.getProfile).toHaveBeenCalledTimes(1);
  expect(mocks.paper).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(mocks.listPages).toHaveBeenCalledTimes(2);
  expect(mocks.getProfile).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("suspends reads when no project view is active and refreshes on return", async () => {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<App />); });
  view.rerender(<App active={false} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.listPages).toHaveBeenCalledTimes(1);
  act(() => { event({ type: "mcp", ts: 1, tool: "draw", ok: true, changed: true }); });
  expect(mocks.listPages).toHaveBeenCalledTimes(1);
  mocks.listPages.mockResolvedValue(index("b"));
  await act(async () => { view.rerender(<App />); });
  expect(screen.getByTestId("designer").textContent).toBe("b:300:1");
  expect(screen.getByTestId("calibration").textContent).toBe("b:300:1");
});

it("batches document/MCP events and ignores a pre-event response", async () => {
  await act(async () => { render(<App />); });
  let resolve!: (value: unknown) => void;
  mocks.listPages.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  const oldSignal = mocks.listPages.mock.calls[1][0];
  mocks.listPages.mockResolvedValue(index("b"));
  act(() => {
    event({ type: "document", ts: 1, action: "active" });
    event({ type: "mcp", ts: 2, tool: "draw", ok: true, changed: true });
  });
  expect(oldSignal.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(mocks.listPages).toHaveBeenCalledTimes(3);
  expect(screen.getByTestId("designer").textContent).toBe("b:300:1");
  expect(screen.getByTestId("calibration").textContent).toBe("b:300:1");
  await act(async () => { resolve(index("a")); });
  expect(screen.getByTestId("designer").textContent).toBe("b:300:1");
});
