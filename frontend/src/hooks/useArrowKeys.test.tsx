// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useArrowKeys } from "./index";
afterEach(cleanup);
it("never turns keyboard navigation in controls into machine movements",()=>{
 const right=vi.fn();function Harness(){useArrowKeys({right},true);return <><button>Tool</button><div role="tablist"><div tabIndex={0}>Tab</div></div><div role="menu"><button>Command</button></div><div role="separator" tabIndex={0}>Resize</div><select aria-label="Step"><option>10</option></select><div role="dialog" tabIndex={0}>Modal</div><div tabIndex={0}>Canvas</div></>}
 render(<Harness/>);
 for(const target of [screen.getByText("Tool"),screen.getByText("Tab"),screen.getByText("Command"),screen.getByText("Resize"),screen.getByLabelText("Step"),screen.getByText("Modal")])fireEvent.keyDown(target,{key:"ArrowRight"});
 expect(right).not.toHaveBeenCalled();fireEvent.keyDown(screen.getByText("Canvas"),{key:"ArrowRight"});expect(right).toHaveBeenCalledOnce();
});
