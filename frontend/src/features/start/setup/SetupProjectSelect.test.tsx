// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageIndex } from "../../../api";
import SetupProjectSelect from "./SetupProjectSelect";
const mocks = vi.hoisted(() => ({ listProjects: vi.fn(), activateProject: vi.fn(), flushEdits: vi.fn(), setIndex: vi.fn() }));
vi.mock("../../../api", () => ({ api: mocks }));
vi.mock("../../../api/pageEdits", () => ({ flushEdits: mocks.flushEdits }));
vi.mock("../../../state/ProjectCalibrationContext", () => ({ useProjectCalibration: () => mocks }));
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const index = { project: { id: "a", name: "First", profileId: "profile-a" }, activeId: "page-a" } as PageIndex;
const next = { project: { id: "b", name: "Second", profileId: "profile-b" }, activeId: "page-b" } as PageIndex;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listProjects.mockResolvedValue([index.project, next.project, { id: "archived", name: "Archived", archived: true }]);
  mocks.flushEdits.mockResolvedValue(undefined); mocks.activateProject.mockResolvedValue(next);
});
afterEach(cleanup);
it("saves the current page before switching project and its profile", async () => {
  let finish!: () => void;
  mocks.flushEdits.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  render(<SetupProjectSelect index={index} enabled />);
  await screen.findByRole("option", { name: "Second" });
  expect(screen.queryByRole("option", { name: "Archived" })).not.toBeInTheDocument();
  const select = screen.getByRole("combobox", { name: "setup.projectSelect" });
  fireEvent.change(select, { target: { value: "b" } });
  expect(select).toBeDisabled();
  expect(mocks.flushEdits).toHaveBeenCalledWith("page-a");
  expect(mocks.activateProject).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(mocks.activateProject).toHaveBeenCalledExactlyOnceWith("b");
  expect(mocks.setIndex).toHaveBeenCalledExactlyOnceWith(next);
});
it("keeps the current project if saving pending edits fails", async () => {
  mocks.flushEdits.mockRejectedValue(new Error("Save failed"));
  render(<SetupProjectSelect index={index} enabled />);
  await screen.findByRole("option", { name: "Second" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
  expect(screen.getByRole("combobox")).toHaveValue("a");
  expect(mocks.activateProject).not.toHaveBeenCalled();
});
it("cancels a pending switch if the workspace becomes unavailable during saving", async () => {
  let finish!: () => void;
  mocks.flushEdits.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<SetupProjectSelect index={index} enabled />);
  await screen.findByRole("option", { name: "Second" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
  view.rerender(<SetupProjectSelect index={index} enabled={false} />);
  await act(async () => finish());
  expect(mocks.activateProject).not.toHaveBeenCalled();
  expect(mocks.setIndex).not.toHaveBeenCalled();
});
it("offers a retry after the project list fails to load", async () => {
  mocks.listProjects.mockRejectedValueOnce(new Error("List failed"));
  render(<SetupProjectSelect index={index} enabled />);
  expect(await screen.findByRole("alert")).toHaveTextContent("List failed");
  fireEvent.click(screen.getByRole("button", { name: "common.reload" }));
  await screen.findByRole("option", { name: "Second" });
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
it("does not switch after leaving setup while a page save is pending", async () => {
  let finish!: () => void;
  mocks.flushEdits.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<SetupProjectSelect index={index} enabled />);
  await screen.findByRole("option", { name: "Second" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
  view.unmount();
  await act(async () => finish());
  expect(mocks.activateProject).not.toHaveBeenCalled();
});
