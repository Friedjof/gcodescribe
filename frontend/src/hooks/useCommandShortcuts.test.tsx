// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { executeCommand, useCommandShortcuts } from "./useCommandShortcuts";
import { matchesCommand } from "../interface/shortcuts";
afterEach(cleanup);
it("uses the active editor ahead of app fallbacks regardless of registration order", () => {
  const app = vi.fn(), editor = vi.fn();
  function Editor({ hidden = false }) {
    const root = useRef<HTMLDivElement>(null);
    useCommandShortcuts([{command:"newSlide",run:editor}], true, root);
    return <div ref={root} hidden={hidden}>Editor</div>;
  }
  function App({ hidden = false }) {
    useCommandShortcuts([{command:"newSlide",run:app}]);
    return <Editor hidden={hidden}/>;
  }
  const view = render(<App/>);
  fireEvent.keyDown(window, {key:"n",ctrlKey:true});
  expect(editor).toHaveBeenCalledOnce(); expect(app).not.toHaveBeenCalled();
  view.rerender(<App hidden/>);
  fireEvent.keyDown(window, {key:"n",ctrlKey:true}); expect(app).toHaveBeenCalledOnce();
  view.unmount();
  expect(fireEvent.keyDown(window, {key:"n",ctrlKey:true})).toBe(true);
});
it("preserves native text selection but saves from a text input and shares menu actions", () => {
  const save = vi.fn(), select = vi.fn();
  function App() {
    useCommandShortcuts([{command:"save",run:save,input:true},{command:"selectAll",run:select}]);
    return <input aria-label="Text"/>;
  }
  const view=render(<App/>), input=view.getByRole("textbox"); input.focus();
  expect(fireEvent.keyDown(input,{key:"a",ctrlKey:true})).toBe(true);expect(select).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input,{key:"s",ctrlKey:true})).toBe(false);expect(save).toHaveBeenCalledOnce();
  executeCommand("save");expect(save).toHaveBeenCalledTimes(2);
  fireEvent.compositionStart(input);fireEvent.keyDown(input,{key:"s",ctrlKey:true});expect(save).toHaveBeenCalledTimes(2);
  fireEvent.compositionEnd(input);
});
it("lets only the topmost modal editor handle commands", () => {
  const outer=vi.fn(),inner=vi.fn();
  function App() {
    const background=useRef<HTMLDivElement>(null), modal=useRef<HTMLDivElement>(null);
    useCommandShortcuts([{command:"zoomIn",run:outer}],true,background);
    useCommandShortcuts([{command:"zoomIn",run:inner}],true,modal);
    return <><div ref={background}/><div role="dialog" aria-modal="true"><input type="checkbox"/><div ref={modal}/></div></>;
  }
  const view=render(<App/>);fireEvent.keyDown(view.getByRole("checkbox"),{key:"+",ctrlKey:true});
  expect(inner).toHaveBeenCalledOnce();expect(outer).not.toHaveBeenCalled();
});
it("suppresses repeats for document creation but permits held zoom keys", () => {
  const create=vi.fn(),zoom=vi.fn();
  function App(){useCommandShortcuts([{command:"newSlide",run:create},{command:"zoomIn",run:zoom}]);return null;}
  render(<App/>);fireEvent.keyDown(window,{key:"n",ctrlKey:true,repeat:true});fireEvent.keyDown(window,{key:"+",ctrlKey:true,repeat:true});
  expect(create).not.toHaveBeenCalled();expect(zoom).toHaveBeenCalledOnce();
});
it("recognizes Linux layouts and does not confuse shifted or system commands", () => {
  for(const event of [{key:"+",ctrlKey:true},{key:"+",ctrlKey:true,shiftKey:true},{key:"=",ctrlKey:true},{key:"+",code:"NumpadAdd",ctrlKey:true}])
    expect(matchesCommand(new KeyboardEvent("keydown",event),"zoomIn")).toBe(true);
  expect(matchesCommand(new KeyboardEvent("keydown",{key:"?",ctrlKey:true,shiftKey:true}),"shortcuts")).toBe(true);
  expect(matchesCommand(new KeyboardEvent("keydown",{key:"n",ctrlKey:true,shiftKey:true}),"newSlide")).toBe(false);
  expect(matchesCommand(new KeyboardEvent("keydown",{key:"n",ctrlKey:true,altKey:true}),"newSlide")).toBe(false);
});
