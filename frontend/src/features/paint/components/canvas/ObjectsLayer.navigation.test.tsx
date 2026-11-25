// @vitest-environment jsdom
import {render,cleanup,fireEvent} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import type {SceneObject} from "../../../../api";
import ObjectsLayer from "./ObjectsLayer";
import { rasterStrokeWidth } from "../../lib/rasterPreview";
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
 // Creating a URL must not hide the drawing before WebKit loads its image.
 expect(originalPath?.parentElement?.getAttribute("display")).toBeNull();
 expect(originalImage?.getAttribute("style")).toBeNull();
 fireEvent.load(originalImage!);
 expect(originalPath?.parentElement?.getAttribute("display")).toBe("none");
 rerender(view(.01,true));
 expect(mocks.raster).toHaveBeenLastCalledWith(object.cachedPolylines,rasterStrokeWidth(200,.3),true);
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
it("restores complete vectors if the bitmap fails to display",()=>{
 const object:SceneObject={id:"dense",type:"line",cachedPolylines:[[[0,0],[200,200]]]};
 const {container}=render(<svg><ObjectsLayer objects={[object]} selectedIds={[]} stroke={.3}/></svg>);
 const image=container.querySelector("image")!,path=container.querySelector("path")!;
 fireEvent.load(image);
 expect(path.parentElement?.getAttribute("display")).toBe("none");
 fireEvent.error(image);
 expect(path.parentElement?.getAttribute("display")).toBeNull();
 expect(path.getAttribute("d")).toBe("M0 0L200 200");
 expect(image.getAttribute("display")).toBe("none");
});
