// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import WorkspaceTabs from "./WorkspaceTabs";
import { workspaceById, type WorkspaceId } from "../../interface/workspaces";
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
it("provides ordered editor tabs with roving keyboard focus", () => {
  function Tabs() {
    const [active, setActive] = useState<WorkspaceId>("paint");
    return <WorkspaceTabs workspaces={["start", "paint", "games"].map(id => workspaceById(id as WorkspaceId))} active={active} onChange={setActive} onCustomize={vi.fn()} />;
  }
  render(<Tabs />);
  const draw = screen.getByRole("tab", { name: "workspace.paint" });
  fireEvent.keyDown(draw, { key: "ArrowRight" });
  const templates = screen.getByRole("tab", { name: "workspace.games" });
  expect(templates.getAttribute("aria-selected")).toBe("true"); expect(document.activeElement).toBe(templates);
  fireEvent.keyDown(templates, { key: "Home" });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "workspace.start" }));
});

it("keeps the active tab visible and cycles only the displayed tabs when overflowing", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({x:0,y:0,width:80,height:30,top:0,left:0,right:80,bottom:30,toJSON:()=>({})});
  function Tabs() {
    const [active,setActive]=useState<WorkspaceId>("paper");
    return <WorkspaceTabs workspaces={["start","paint","games","gallery","paper"].map(id=>workspaceById(id as WorkspaceId))} active={active} onChange={setActive} onCustomize={vi.fn()}/>;
  }
  render(<Tabs />);
  expect(screen.getAllByRole("tab").map(tab=>tab.textContent)).toEqual(["workspace.start","workspace.paint","workspace.paper"]);
  fireEvent.keyDown(screen.getByRole("tab",{name:"workspace.start"}),{key:"ArrowLeft"});
  expect(document.activeElement).toBe(screen.getByRole("tab",{name:"workspace.paper"}));
  fireEvent.click(screen.getByRole("button",{name:"interface.moreTabs"}));
  expect(screen.getByRole("menuitem",{name:"workspace.gallery"})).toBeTruthy();
  vi.restoreAllMocks();
});
