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

it("owns arrow keys on focused jog buttons inside a dialog, including repeats and busy requests", async () => {
  const { createRef } = await import("react");
  const scope = createRef<HTMLDivElement>();
  const up = vi.fn();
  function Harness({ moving = false }: { moving?: boolean }) {
    useArrowKeys({ up }, true, { scope, motionEnabled: !moving });
    return <div role="dialog"><div ref={scope} tabIndex={0}>
      <button>Jog up</button><input aria-label="Value" />
      <div role="dialog"><button>Nested modal</button></div>
    </div><button>Other command</button></div>;
  }
  const view = render(<Harness />);
  const button = screen.getByRole("button", { name: "Jog up" });
  expect(fireEvent.keyDown(button, { key: "ArrowUp", cancelable: true })).toBe(false);
  expect(up).toHaveBeenCalledOnce();
  expect(fireEvent.keyDown(button, { key: "ArrowUp", repeat: true, cancelable: true })).toBe(false);
  expect(up).toHaveBeenCalledOnce();
  view.rerender(<Harness moving />);
  expect(fireEvent.keyDown(button, { key: "ArrowUp", cancelable: true })).toBe(false);
  expect(up).toHaveBeenCalledOnce();
  for (const target of [screen.getByLabelText("Value"), screen.getByText("Other command"), screen.getByText("Nested modal")]) {
    expect(fireEvent.keyDown(target, { key: "ArrowUp", cancelable: true })).toBe(true);
  }
  expect(up).toHaveBeenCalledOnce();
});
