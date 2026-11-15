// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import EditorMenu from "./EditorMenu";
afterEach(cleanup);
const setup = () => {
  const action = vi.fn();
  const props = {label:"Edit",items:[{id:"copy",label:"Copy",disabled:true,action},{id:"paste",label:"Paste",action},{id:"duplicate",label:"Duplicate",action}]};
  const view=render(<EditorMenu {...props} />);
  return {...view,props,action};
};
it("skips disabled commands, cycles focus and returns it on Escape", () => {
  setup(); const trigger=screen.getByRole("button",{name:"Edit"});
  fireEvent.keyDown(trigger,{key:"ArrowDown"});
  expect(document.activeElement).toBe(screen.getByRole("menuitem",{name:"Paste"}));
  fireEvent.keyDown(document.activeElement!,{key:"ArrowDown"});
  expect(document.activeElement).toBe(screen.getByRole("menuitem",{name:"Duplicate"}));
  fireEvent.keyDown(document.activeElement!,{key:"ArrowDown"});
  expect(document.activeElement).toBe(screen.getByRole("menuitem",{name:"Paste"}));
  fireEvent.keyDown(document.activeElement!,{key:"Escape"});
  expect(screen.queryByRole("menu")).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it("runs a command once and dismisses when its workspace becomes hidden", () => {
  const view=setup(); const trigger=screen.getByRole("button",{name:"Edit"});
  fireEvent.click(trigger); fireEvent.click(screen.getByRole("menuitem",{name:"Duplicate"}));
  expect(view.action).toHaveBeenCalledOnce(); expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(trigger); view.rerender(<EditorMenu {...view.props} active={false} />);
  expect(screen.queryByRole("menu")).toBeNull();
});
