// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderComponent, screen, waitFor, within } from "@testing-library/react";
import { ProjectCalibrationProvider } from "../../state/ProjectCalibrationContext";
import type { ReactElement } from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProjectOverviewPopup from "./ProjectOverviewPopup";

const render = (ui: ReactElement) => renderComponent(ui, { wrapper: ({ children }) =>
  <ProjectCalibrationProvider active={false}>{children}</ProjectCalibrationProvider> });

const calls = vi.hoisted(() => ({ listProjects: vi.fn(), listProfiles: vi.fn(), activateProject: vi.fn(),
  getProfile: vi.fn(), saveProfile: vi.fn(), updateProject: vi.fn(), createProject: vi.fn() }));
vi.mock("../../api/events", () => ({ onAppEvent: () => () => {} }));
vi.mock("../../api", () => ({ api: calls }));
vi.mock("../../i18n", async () => {
 const de=(await import("../../i18n/de")).default;
 return {useI18n:()=>({t:(key:string,vars:Record<string,string|number>={})=>{
  let value=key.startsWith("paging.")?key:de[key]??key;
  for(const [name,item] of Object.entries(vars))value=value.split(`{${name}}`).join(String(item));
  return value;
 }})};
});
afterEach(cleanup);

beforeEach(() => {
  calls.listProjects.mockReset().mockResolvedValue([
    { id: "a", name: "Projekt A", profileId: "pa", activeId: "sa", modified: 1, archived: false, slideCount: 2 },
    { id: "b", name: "Projekt B", profileId: "pb", activeId: "sb", modified: 2, archived: false, slideCount: 1 },
  ]);
  calls.listProfiles.mockReset().mockResolvedValue([
    { id: "pa", name: "Profil A" }, { id: "pb", name: "Profil B" },
  ]);
  calls.activateProject.mockReset().mockResolvedValue({ activeId: "sb", order: [], groups: [], project: { id: "b" } });
  calls.getProfile.mockReset().mockResolvedValue({ id: "pa", name: "Profil A", calibration: {
    paper_corners: {}, obstacles: [], defined_positions: [], plot_width: 100,
  } });
  calls.saveProfile.mockReset().mockResolvedValue({});
  calls.updateProject.mockReset().mockResolvedValue({});
  calls.createProject.mockReset().mockResolvedValue({ activeId: "new-slide", order: [], project: { id: "new" } });
});

it("switches projects from the popup after saving the open slide", async () => {
  const beforeChange = vi.fn().mockResolvedValue(undefined);
  const onActivate = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(<ProjectOverviewPopup activeId="a" beforeChange={beforeChange}
    onRefresh={vi.fn()} onActivate={onActivate} onClose={onClose}
    confirm={vi.fn().mockResolvedValue(true)} />);
  expect(await screen.findByText("Projekt B")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Öffnen" }));
  await waitFor(() => expect(onActivate).toHaveBeenCalledOnce());
  expect(beforeChange.mock.invocationCallOrder[0]).toBeLessThan(calls.activateProject.mock.invocationCallOrder[0]);
  expect(calls.activateProject).toHaveBeenCalledWith("b");
  expect(onClose).toHaveBeenCalledOnce();
});

it("filters projects and separates archived projects", async () => {
  calls.listProjects.mockResolvedValueOnce([
    { id: "a", name: "Briefe", profileId: "pa", modified: 3, archived: false, slideCount: 2 },
    { id: "b", name: "Notizen", profileId: "pb", modified: 2, archived: false, slideCount: 1 },
    { id: "c", name: "Alte Skizzen", profileId: "pc", modified: 1, archived: true, slideCount: 4 },
  ]);
  render(<ProjectOverviewPopup activeId="a" beforeChange={vi.fn()} onRefresh={vi.fn()}
    onActivate={vi.fn()} onClose={vi.fn()} confirm={vi.fn()} />);
  expect(await screen.findByText("Notizen")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Projekte suchen" }), { target: { value: "Brie" } });
  expect(screen.queryByText("Notizen")).toBeNull();
  expect(screen.getByText("Briefe")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Projekte suchen" }), { target: { value: "" } });
  fireEvent.click(screen.getByRole("tab", { name: "Archiv 1" }));
  expect(screen.getByText("Alte Skizzen")).toBeTruthy();
  expect(screen.queryByText("Briefe")).toBeNull();
});

it("saves project and profile names from the project settings", async () => {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  render(<ProjectOverviewPopup activeId="a" beforeChange={vi.fn()} onRefresh={onRefresh}
    onActivate={vi.fn()} onClose={vi.fn()} confirm={vi.fn()} />);
  const projectCard = (await screen.findByText("Projekt A")).closest("article");
  expect(projectCard).toBeTruthy();
  fireEvent.click(within(projectCard!).getByRole("button", { name: "Einstellungen" }));
  expect(await screen.findByDisplayValue("Profil A")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Projektname"), { target: { value: "Briefe" } });
  fireEvent.change(screen.getByLabelText("Profilname"), { target: { value: "Federhalter" } });
  fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
  await waitFor(() => expect(calls.updateProject).toHaveBeenCalledWith("a", { name: "Briefe" }));
  expect(calls.saveProfile).toHaveBeenCalledWith("pa", { name: "Federhalter", calibration: {} });
  expect(onRefresh).toHaveBeenCalledOnce();
});

it("assigns the selected existing profile when saving without copying or changing its calibration", async () => {
  calls.getProfile.mockImplementation(async (id: string) => ({
    id, name: id === "pb" ? "Profil B" : "Profil A",
    calibration: id === "pb"
      ? { origin_x: 25, plot_width: 145, paper_corners: { bl: [25, 3], tr: [170, 209] }, obstacles: [], defined_positions: [] }
      : { origin_x: 1, plot_width: 166, paper_corners: { bl: [0, 3], tr: [168, 210] }, obstacles: [], defined_positions: [] },
  }));
  render(<ProjectOverviewPopup activeId="a" beforeChange={vi.fn()}
    onRefresh={vi.fn().mockResolvedValue(undefined)} onActivate={vi.fn()}
    onClose={vi.fn()} confirm={vi.fn()} />);
  const projectCard = (await screen.findByText("Projekt A")).closest("article")!;
  fireEvent.click(within(projectCard).getByRole("button", { name: "Einstellungen" }));
  const selector = await screen.findByRole("combobox", { name: "Profil" });
  expect(selector).toHaveValue("pa");
  fireEvent.change(selector, { target: { value: "pb" } });
  await waitFor(() => expect(screen.getByLabelText("Ursprung X")).toHaveValue(25));
  expect(selector).toHaveValue("pb");
  expect(calls.saveProfile).not.toHaveBeenCalled();
  expect(calls.updateProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
  await waitFor(() => expect(calls.updateProject).toHaveBeenCalledWith("a", {
    name: "Projekt A", profileId: "pb",
  }));
  expect(calls.saveProfile).not.toHaveBeenCalled();
});

it("offers the same existing profile selection when creating a project", async () => {
  const onActivate = vi.fn().mockResolvedValue(undefined);
  render(<ProjectOverviewPopup activeId="a" beforeChange={vi.fn()}
    onRefresh={vi.fn()} onActivate={onActivate} onClose={vi.fn()} confirm={vi.fn()} />);
  await screen.findByText("Projekt A");
  fireEvent.click(screen.getByRole("button", { name: /Neues Projekt/ }));
  fireEvent.change(screen.getByLabelText("Projektname"), { target: { value: "Briefe" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Profil" }), { target: { value: "pb" } });
  fireEvent.click(screen.getByRole("button", { name: "Projekt erstellen" }));
  await waitFor(() => expect(calls.createProject).toHaveBeenCalledWith("Briefe", undefined, "pb"));
  expect(onActivate).toHaveBeenCalledOnce();
});

it("saves the optional pressure depth in the selected project profile", async () => {
  render(<ProjectOverviewPopup activeId="a" beforeChange={vi.fn()}
    onRefresh={vi.fn()} onActivate={vi.fn()} onClose={vi.fn()} confirm={vi.fn()} />);
  const projectCard = (await screen.findByText("Projekt A")).closest("article")!;
  fireEvent.click(within(projectCard).getByRole("button", { name: "Einstellungen" }));
  const depth = await screen.findByLabelText("Maximale Zusatzabsenkung (mm)");
  expect(depth).toHaveValue(0);
  fireEvent.change(depth, { target: { value: "0.25" } });
  fireEvent.click(screen.getByRole("button", { name: "Änderungen speichern" }));
  await waitFor(() => expect(calls.saveProfile).toHaveBeenCalledWith("pa", {
    name: "Profil A", calibration: { pen_pressure_max_depth: 0.25 },
  }));
});
