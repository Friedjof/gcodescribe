// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Modal from "../components/Modal";
vi.mock("../i18n",()=>({useI18n:()=>({t:(key:string)=>key})}));
afterEach(cleanup);
it("traps Tab, restores the opener and leaves underlying Escape handlers alone",()=>{
 const outsideEscape=vi.fn();window.addEventListener("keydown",outsideEscape);
 function Harness(){const [open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Open</button>{open && <Modal title="Dialog" onClose={()=>setOpen(false)}><input aria-label="Name"/><button>Last</button></Modal>}</>}
 render(<Harness/>);const opener=screen.getByRole("button",{name:"Open"});opener.focus();fireEvent.click(opener);
 const close=screen.getByRole("button",{name:"common.close"}),last=screen.getByRole("button",{name:"Last"});
 expect(document.activeElement).toBe(close);last.focus();fireEvent.keyDown(last,{key:"Tab"});expect(document.activeElement).toBe(close);
 fireEvent.keyDown(close,{key:"Tab",shiftKey:true});expect(document.activeElement).toBe(last);
 opener.focus();expect(document.activeElement).toBe(close);
 outsideEscape.mockClear();fireEvent.keyDown(close,{key:"Escape"});expect(screen.queryByRole("dialog")).toBeNull();expect(document.activeElement).toBe(opener);
 expect(outsideEscape).not.toHaveBeenCalled();window.removeEventListener("keydown",outsideEscape);
});
it("only dismisses the top dialog when dialogs are nested",()=>{
 const parentClose=vi.fn();function Harness(){const [child,setChild]=useState(false);return <Modal title="Parent" onClose={parentClose}><button onClick={()=>setChild(true)}>Nested</button>{child && <Modal title="Child" onClose={()=>setChild(false)}>Content</Modal>}</Modal>}
 render(<Harness/>);screen.getByRole("button",{name:"Nested"}).focus();fireEvent.click(screen.getByRole("button",{name:"Nested"}));
 expect(screen.getAllByRole("dialog")).toHaveLength(2);fireEvent.keyDown(document.activeElement!,{key:"Escape"});
 expect(screen.getAllByRole("dialog")).toHaveLength(1);expect(parentClose).not.toHaveBeenCalled();expect(document.activeElement).toBe(screen.getByRole("button",{name:"Nested"}));
});
