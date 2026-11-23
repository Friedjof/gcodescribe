// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BackgroundTasks from "./BackgroundTasks";
import { dismissAllTasks } from "../api/assetTasks";

const mocks = vi.hoisted(() => ({ req: vi.fn(), error: vi.fn(), listener: null as ((event: any) => void) | null }));
vi.mock("../api/client/req", () => ({ req: mocks.req }));
vi.mock("../api/events", () => ({ onAppEvent: (listener: (event: any) => void) => { mocks.listener = listener; return () => { mocks.listener = null; }; } }));
vi.mock("../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./Toasts", () => ({ useToasts: () => ({ error: mocks.error }) }));
let seq = 0;
const task = (state: string) => ({ id: `task-${seq++}`, kind: "import", filename: `${state}.svg`, state, phase: state, created: seq, updated: seq });
beforeEach(async () => {
  mocks.req.mockResolvedValue({ ok: true }); await dismissAllTasks();
  mocks.req.mockReset(); mocks.error.mockReset();
});
afterEach(cleanup);

it("closes all notifications together while active imports continue and still publish results", async () => {
  const running = task("running"), done = task("done"), failed = task("failed");
  mocks.req.mockImplementation(async (url: string) => url === "/api/asset-tasks" ? [running, done, failed] : { ok: true });
  render(<BackgroundTasks onOpenResult={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /tasks.title/ }));
  await screen.findByText("running.svg");
  fireEvent.click(screen.getByRole("button", { name: "tasks.dismissAll" }));
  await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  const mutations = mocks.req.mock.calls.filter(([, options]) => options?.method);
  expect(mutations.map(([url]) => url).sort()).toEqual([`/api/asset-tasks/${done.id}`, `/api/asset-tasks/${failed.id}`].sort());
  const ready = vi.fn(); window.addEventListener("gcs:asset-ready", ready);
  act(() => mocks.listener?.({ type: "asset-task", task: { ...running, state: "done", phase: "done", item_id: "result", updated: 100 } }));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(ready).toHaveBeenCalledOnce();
  expect(JSON.parse(localStorage.getItem("gcs.hiddenAssetTasks.v1")!)).toContain(running.id);
  window.removeEventListener("gcs:asset-ready", ready);
});

it("keeps failed dismissals visible and reports the error while closing the others", async () => {
  const done = task("done"), failed = task("failed");
  mocks.req.mockImplementation(async (url: string) => {
    if (url === "/api/asset-tasks") return [done, failed];
    if (url.endsWith(failed.id)) throw new Error("Server unavailable");
    return { ok: true };
  });
  render(<BackgroundTasks onOpenResult={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /tasks.title/ }));
  fireEvent.click(screen.getByRole("button", { name: "tasks.dismissAll" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Server unavailable"));
  expect(screen.queryByText("done.svg")).toBeNull();
  expect(screen.getByText("failed.svg")).toBeInTheDocument();
});

it("minimizes to a counted bell and reopens the task list",async()=>{
 const running=task("running"),done=task("done");mocks.req.mockResolvedValue([running,done]);
 const {container}=render(<BackgroundTasks onOpenResult={vi.fn()}/>);
 await screen.findByRole("button",{name:/tasks.title/});
 fireEvent.click(screen.getByRole("button",{name:"tasks.compact"}));
 expect(container.querySelector(".tasks-mini .tasks-counter")?.textContent).toBe("2");
 expect(localStorage.getItem("gcs.tasks.compact.v1")).toBe("true");
 fireEvent.click(screen.getByRole("button",{name:/tasks.title/}));
 expect(await screen.findByText("running.svg")).toBeInTheDocument();
 expect(container.querySelector(".tasks-mini")).toBeNull();
});
