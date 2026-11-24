// @vitest-environment jsdom
import {render,cleanup} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import type {SceneObject} from "../../../../api";
import ObjectsLayer from "./ObjectsLayer";
const mocks=vi.hoisted(()=>({raster:vi.fn()}));
vi.mock("../../hooks/useGeometryPath",()=>({useGeometryPath:()=>"M0 0L200 200"}));
vi.mock("../../hooks/useGeometryRaster",()=>({rasterGeometry:()=>true,rasterFitsDisplay:(_:unknown,stroke:number)=>stroke>.1,useGeometryRaster:(lines:unknown,stroke:number,active:boolean)=>{
 mocks.raster(lines,stroke,active);return {image:active?{url:"blob:complete",x:0,y:0,width:200,height:200}:null};
}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("retains the bitmap through a gesture and returns to precise vector detail at rest",()=>{
 const object:SceneObject={id:"dense",type:"line",cachedPolylines:[[[0,0],[200,200]]]};
 const before=JSON.stringify(object);
 const view=(stroke:number,interactive:boolean)=><svg><ObjectsLayer objects={[object]} selectedIds={[]} stroke={stroke} interactive={interactive}/></svg>;
 const {container,rerender}=render(view(.3,false));
 const originalPath=container.querySelector("path");
 const originalImage=container.querySelector("image");
 expect(container.querySelector("image")).not.toBeNull();
 rerender(view(.01,true));
 expect(mocks.raster).toHaveBeenLastCalledWith(object.cachedPolylines,.3,true);
 expect(container.querySelector("image")?.getAttribute("href")).toBe("blob:complete");
 rerender(view(.01,false));
 expect(container.querySelector("image")?.getAttribute("display")).toBe("none");expect(container.querySelector("path")?.getAttribute("d")).toBe("M0 0L200 200");
 // A new gesture at high zoom must reuse the warm bitmap immediately.
 rerender(view(.01,true));
 expect(container.querySelector("image")?.getAttribute("href")).toBe("blob:complete");
 expect(container.querySelector("image")?.getAttribute("display")).toBeNull();
 rerender(view(.01,false));
 expect(container.querySelector("path")?.getAttribute("d")).toBe("M0 0L200 200");
 expect(container.querySelector("path")).toBe(originalPath);
 expect(container.querySelector("image")).toBe(originalImage);
 expect(JSON.stringify(object)).toBe(before);
});
