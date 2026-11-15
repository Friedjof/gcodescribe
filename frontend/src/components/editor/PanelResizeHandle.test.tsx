// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PanelResizeHandle from "./PanelResizeHandle";
beforeEach(() => {
  class Pointer extends MouseEvent { pointerId = 1; }
  vi.stubGlobal("PointerEvent", Pointer);
  Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = (direction: 1 | -1 = 1) => {
  const onChange = vi.fn(), onCommit = vi.fn();
  const view = render(<PanelResizeHandle label="Pages width" width={220} min={180} max={400} onChange={onChange} onCommit={onCommit} direction={direction} />);
  return { handle: view.getByRole("separator"), onChange, onCommit };
};
it("previews bounded width and saves once on release", () => {
  const {handle,onChange,onCommit} = setup();
  fireEvent.pointerDown(handle,{button:0,clientX:100}); fireEvent.pointerMove(handle,{clientX:900});
  expect(onChange).toHaveBeenLastCalledWith(400); expect(onCommit).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle); fireEvent.lostPointerCapture(handle);
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(400);
});
it.each(["escape","cancel","blur"])("restores the previous width without saving on %s", mode => {
  const {handle,onChange,onCommit} = setup();
  fireEvent.pointerDown(handle,{button:0,clientX:100}); fireEvent.pointerMove(handle,{clientX:140});
  if (mode === "escape") fireEvent.keyDown(window,{key:"Escape"});
  else if(mode === "cancel") fireEvent.pointerCancel(handle); else fireEvent.blur(window);
  fireEvent.pointerUp(handle);
  expect(onChange).toHaveBeenLastCalledWith(220); expect(onCommit).not.toHaveBeenCalled();
});
it("supports the keyboard and reverses the right pane direction", () => {
  const {handle,onCommit} = setup(-1);
  fireEvent.keyDown(handle,{key:"ArrowLeft",shiftKey:true}); expect(onCommit).toHaveBeenLastCalledWith(260);
  fireEvent.keyDown(handle,{key:"Home"}); expect(onCommit).toHaveBeenLastCalledWith(180);
  fireEvent.keyDown(handle,{key:"End"}); expect(onCommit).toHaveBeenLastCalledWith(400);
});
