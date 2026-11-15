// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePaintShortcuts } from "./usePaintShortcuts";
import type { ObjectOps } from "./useObjectOps";
afterEach(cleanup);
it("does not nudge a selection or edit text while navigating program controls", () => {
 const ops={nudgeSelected:vi.fn(),remember:vi.fn(),editSelectedText:vi.fn(),undo:vi.fn()} as unknown as ObjectOps;
 function Harness(){usePaintShortcuts({active:true,tool:"text",setTool:vi.fn(),selectedIds:["object"],setSelectedIds:vi.fn(),closeMenu:vi.fn(),ops,page:null,defaultText:"Text"});
 return <><button>Tool</button><select aria-label="Size"><option>10</option></select><div role="separator" tabIndex={0}>Resize</div><button role="menuitem">Copy</button></>}
 const view=render(<Harness />);
 for(const target of [view.getByText("Tool"),view.getByLabelText("Size"),view.getByRole("separator")]){
  fireEvent.keyDown(target,{key:"ArrowRight"});fireEvent.keyDown(target,{key:"x"});
 }
 expect(ops.nudgeSelected).not.toHaveBeenCalled();expect(ops.editSelectedText).not.toHaveBeenCalled();
 fireEvent.keyDown(view.getByText("Tool"),{key:"z",ctrlKey:true});expect(ops.undo).toHaveBeenCalledOnce();
});
