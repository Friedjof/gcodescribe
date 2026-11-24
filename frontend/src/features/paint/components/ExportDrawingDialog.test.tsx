// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Calibration, Page } from "../../../api";
import ExportDrawingDialog from "./ExportDrawingDialog";
vi.mock("../../../i18n",()=>({useI18n:()=>({t:(key:string)=>key})}));
vi.mock("../../../api/pageEdits",()=>({cachedPage:()=>undefined,flushEdits:()=>Promise.resolve()}));
vi.mock("../lib/geometryTasks",()=>({preparePath:async()=>"M10 20L20 20"}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const page={id:"test",name:"Drawing",objects:[{id:"line",type:"pen",cachedPolylines:[[[0,0],[10,0]]],transform:{x:10,y:20,rotation:0,scale:1}},{id:"mask",type:"mask-rect",cachedPolylines:[[[0,0],[1,0],[1,1],[0,0]]]}]} as Page;
const cal={plot_width:200,plot_height:140} as Calibration;
it.each(["svg","json"])("downloads a %s snapshot without changing source geometry",async format=>{
 const blobs:Blob[]=[];vi.stubGlobal("URL",{createObjectURL:(blob:Blob)=>{blobs.push(blob);return "blob:test";},revokeObjectURL:vi.fn()});
 const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{}),close=vi.fn();
 const source=JSON.stringify(page);const view=render(<ExportDrawingDialog page={page} cal={cal} onClose={close}/>);
 fireEvent.change(view.getByRole("combobox"),{target:{value:format}});fireEvent.click(view.getByRole("button",{name:"shortcuts.export"}));
 await waitFor(()=>expect(close).toHaveBeenCalledOnce());
 expect(click).toHaveBeenCalledOnce();expect(blobs[0].type).toBe(format==="svg"?"image/svg+xml":"application/json");
 const text=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(blobs[0]);});
 if(format==="svg"){
  const document=new DOMParser().parseFromString(text,"image/svg+xml");
  expect(document.documentElement.getAttribute("width")).toBe("200mm");
  expect(document.querySelectorAll("path")).toHaveLength(2);expect(document.querySelectorAll("path")[1].getAttribute("fill")).toBe("white");
 }else{expect(JSON.parse(text)).toMatchObject({format:"gcodescribe-slide",page,calibration:cal});}
 expect(JSON.stringify(page)).toBe(source);
});
