// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PageIndex } from "../../api";
import ProjectPagePanel from "./ProjectPagePanel";

vi.mock("../../i18n", async () => {
 const de=(await import("../../i18n/de")).default;
 return {useI18n:()=>({t:(key:string,vars:Record<string,string|number>={})=>{
  let value=key.startsWith("paging.")?key:de[key]??key;
  for(const [name,item] of Object.entries(vars))value=value.split(`{${name}}`).join(String(item));
  return value;
 }})};
});
afterEach(cleanup);

it("shows the active project's folder tree and opens the project popup", () => {
  const openProjects = vi.fn();
  const openPage = vi.fn();
  const index: PageIndex = {
    activeId: "a", project: { id: "p", name: "Briefe", profileId: "profile", activeId: "a", modified: 0, archived: false },
    groups: [{ id: "folder", name: "Entwürfe", projectId: "p", parentId: null }],
    order: [{ id: "a", name: "Slide A", created: 0, modified: 0, objectCount: 0, plottedCount: 0, groupId: "folder", projectId: "p" }],
  };
  render(<ProjectPagePanel index={index} activePageId="a" onOpenProjects={openProjects} onOpen={openPage}
    onNew={vi.fn()} onRename={vi.fn()} onDuplicate={vi.fn()} onRemove={vi.fn()} onReorder={vi.fn()}
    onCreateGroup={vi.fn()} onRenameGroup={vi.fn()} onDeleteGroup={vi.fn()}
    onSetPageGroup={vi.fn()} onSetGroupParent={vi.fn()} onMove={vi.fn()} onToggleSidebar={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Entwürfe" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Briefe/ }).getAttribute("aria-haspopup")).toBe("dialog");
  expect(screen.getByRole("button", { name: /Briefe/ }).textContent).not.toContain("⌄");
  fireEvent.click(screen.getByRole("button", { name: /Briefe/ }));
  expect(openProjects).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Slide A" }));
  expect(openPage).toHaveBeenCalledWith("a");
});

it("offers direct slide actions and opens folder actions outside the clipped sidebar", () => {
  const onDuplicate = vi.fn();
  const onCreateGroup = vi.fn();
  const index: PageIndex = {
    activeId: "a", project: { id: "p", name: "Briefe", profileId: "profile", activeId: "a", modified: 0, archived: false },
    groups: [{ id: "folder", name: "Entwürfe", projectId: "p", parentId: null }],
    order: [{ id: "a", name: "Slide A", created: 0, modified: 0, objectCount: 1, plottedCount: 0, groupId: "folder", projectId: "p" }],
  };
  render(<ProjectPagePanel index={index} activePageId="a" onOpenProjects={vi.fn()} onOpen={vi.fn()}
    onNew={vi.fn()} onRename={vi.fn()} onDuplicate={onDuplicate} onRemove={vi.fn()} onReorder={vi.fn()}
    onCreateGroup={onCreateGroup} onRenameGroup={vi.fn()} onDeleteGroup={vi.fn()}
    onSetPageGroup={vi.fn()} onSetGroupParent={vi.fn()} onMove={vi.fn()} onToggleSidebar={vi.fn()} />);

  const duplicate = screen.getByRole("button", { name: "Duplizieren: Slide A" });
  fireEvent.pointerDown(duplicate);
  fireEvent.click(duplicate);
  expect(onDuplicate).toHaveBeenCalledWith("a");
  expect(screen.queryByRole("menu")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Aktionen für Ordner Entwürfe" }));
  const folderMenu = screen.getByRole("menu");
  expect(folderMenu.parentElement).toBe(document.body);
  fireEvent.click(within(folderMenu).getByRole("menuitem", { name: "Unterordner erstellen" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Ordnername" }), { target: { value: "Neu" } });
  fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));
  expect(onCreateGroup).toHaveBeenCalledWith("Neu", "folder");
});

it("allows dragging a slide onto another page of the collection without losing the full order", () => {
 const onReorder = vi.fn();
 const index: PageIndex = { activeId: "s0", groups: [], order: Array.from({ length: 20 }, (_, n) => ({ id: `s${n}`, name: `Slide ${n}`, created: 0, modified: 0, objectCount: 0, plottedCount: 0 })) };
 render(<ProjectPagePanel index={index} activePageId="s0" onOpenProjects={vi.fn()} onOpen={vi.fn()} onNew={vi.fn()} onRename={vi.fn()} onDuplicate={vi.fn()} onRemove={vi.fn()} onReorder={onReorder} onCreateGroup={vi.fn()} onRenameGroup={vi.fn()} onDeleteGroup={vi.fn()} onSetPageGroup={vi.fn()} onSetGroupParent={vi.fn()} onMove={vi.fn()} onToggleSidebar={vi.fn()}/>);
 const source = screen.getByRole("button", { name: "Slide 0" }).closest("li")!;
 fireEvent.dragStart(source);
 fireEvent.dragEnter(screen.getByRole("button", { name: "paging.next" }));
 const target = screen.getByRole("button", { name: "Slide 6" }).closest("li")!;
 fireEvent.dragOver(target); fireEvent.drop(target);
 expect(onReorder).toHaveBeenCalledWith(["s1", "s2", "s3", "s4", "s5", "s0", ...Array.from({ length: 14 }, (_, n) => `s${n + 6}`)]);
});
