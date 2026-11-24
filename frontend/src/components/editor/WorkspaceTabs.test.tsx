// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import WorkspaceTabs from "./WorkspaceTabs";
import { workspaceById, type WorkspaceId } from "../../interface/workspaces";
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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

it("cycles the configured workspace order in both directions from an input", () => {
  function Tabs() {
    const [active, setActive] = useState<WorkspaceId>("font");
    return <><input aria-label="Draft" defaultValue="Unsaved text"/><WorkspaceTabs
      workspaces={["font", "paint", "games"].map(id => workspaceById(id as WorkspaceId))}
      active={active} onChange={setActive} onCustomize={vi.fn()}/></>;
  }
  render(<Tabs/>);
  const input = screen.getByRole("textbox"); input.focus();
  expect(fireEvent.keyDown(input, { key: "Tab", ctrlKey: true })).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "workspace.paint" }));
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "workspace.games" }));
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "workspace.font" }));
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "workspace.games" }));
  expect((input as HTMLInputElement).value).toBe("Unsaved text");
});

it("activates and focuses a workspace from the overflow menu", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({x:0,y:0,width:80,height:30,top:0,left:0,right:80,bottom:30,toJSON:()=>({})});
  function Tabs() {
    const [active, setActive] = useState<WorkspaceId>("paint");
    return <WorkspaceTabs workspaces={["paint", "games", "font", "paper"].map(id => workspaceById(id as WorkspaceId))}
      active={active} onChange={setActive} onCustomize={vi.fn()}/>;
  }
  render(<Tabs/>);
  expect(screen.queryByRole("tab", { name: "workspace.games" })).toBeNull();
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
  const games = screen.getByRole("tab", { name: "workspace.games" });
  expect(games.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(games);
});

it("leaves focus navigation, composition and system shortcuts to their owners", () => {
  const onChange = vi.fn();
  const view = render(<WorkspaceTabs workspaces={[workspaceById("paint"), workspaceById("font")]} active="paint" onChange={onChange} onCustomize={vi.fn()}/>);
  for (const modifiers of [{}, {shiftKey:true}, {ctrlKey:true,altKey:true}, {ctrlKey:true,metaKey:true}, {ctrlKey:true,isComposing:true}]) {
    expect(fireEvent.keyDown(window, { key:"Tab", ...modifiers })).toBe(true);
  }
  const handled = new KeyboardEvent("keydown", {key:"Tab",ctrlKey:true,bubbles:true,cancelable:true});
  handled.preventDefault(); fireEvent(window, handled);
  expect(onChange).not.toHaveBeenCalled();
  view.unmount();
  expect(fireEvent.keyDown(window, {key:"Tab",ctrlKey:true})).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});

it("does not leave a modal or a disabled navigation state", () => {
  const onChange = vi.fn();
  const props = {workspaces:[workspaceById("paint"),workspaceById("font")],active:"paint" as const,onChange,onCustomize:vi.fn()};
  const view = render(<><WorkspaceTabs {...props}/><div role="dialog" aria-modal="true"><input aria-label="Dialog value"/></div></>);
  expect(fireEvent.keyDown(window, {key:"Tab",ctrlKey:true})).toBe(true);
  fireEvent.keyDown(screen.getByRole("textbox"), {key:"Tab",ctrlKey:true});
  expect(onChange).not.toHaveBeenCalled();
  view.rerender(<WorkspaceTabs {...props} shortcutsEnabled={false}/>);
  expect(fireEvent.keyDown(window, {key:"Tab",ctrlKey:true})).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  view.rerender(<><WorkspaceTabs {...props}/><div style={{display:"none"}}><div role="dialog" aria-modal="true"/></div></>);
  expect(fireEvent.keyDown(window, {key:"Tab",ctrlKey:true})).toBe(false);
  expect(onChange).toHaveBeenCalledWith("font");
});

it("uses updated workspace visibility and does not capture Ctrl+Tab for a single workspace", () => {
  const onChange = vi.fn();
  const props = {active:"paint" as const,onChange,onCustomize:vi.fn()};
  const view = render(<WorkspaceTabs {...props} workspaces={[workspaceById("paint"),workspaceById("font")]}/>);
  view.rerender(<WorkspaceTabs {...props} workspaces={[workspaceById("paint"),workspaceById("games")]}/>);
  fireEvent.keyDown(window, {key:"Tab",ctrlKey:true});
  expect(onChange).toHaveBeenCalledExactlyOnceWith("games");
  onChange.mockClear();
  view.rerender(<WorkspaceTabs {...props} workspaces={[workspaceById("paint")]}/>);
  expect(fireEvent.keyDown(window, {key:"Tab",ctrlKey:true})).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps native-forwarded shortcuts out of an active text composition", () => {
  const onChange = vi.fn();
  render(<><input aria-label="Composition"/><WorkspaceTabs workspaces={[workspaceById("paint"),workspaceById("font")]} active="paint" onChange={onChange} onCustomize={vi.fn()}/></>);
  const input = screen.getByRole("textbox");
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, {key:"Tab",ctrlKey:true});
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, {key:"Tab",ctrlKey:true});
  expect(onChange).toHaveBeenCalledExactlyOnceWith("font");
});
it("supports PageUp/PageDown aliases and Alt-number workspace selection", () => {
  function Tabs(){const [active,setActive]=useState<WorkspaceId>("paint");return <WorkspaceTabs workspaces={["paint","font","games"].map(id=>workspaceById(id as WorkspaceId))} active={active} onChange={setActive} onCustomize={vi.fn()}/>;}
  render(<Tabs/>);
  fireEvent.keyDown(window,{key:"PageDown",ctrlKey:true});
  expect(document.activeElement?.id).toBe("workspace-tab-font");
  fireEvent.keyDown(window,{key:"PageUp",ctrlKey:true});
  expect(document.activeElement?.id).toBe("workspace-tab-paint");
  fireEvent.keyDown(window,{key:"9",altKey:true});
  expect(document.activeElement?.id).toBe("workspace-tab-games");
  fireEvent.keyDown(window,{key:"2",altKey:true});
  expect(document.activeElement?.id).toBe("workspace-tab-font");
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
