// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PaintToolRail from "./PaintToolRail";
vi.mock("../../../i18n",()=>({useI18n:()=>({t:(key:string)=>key})}));
afterEach(cleanup);
it("offers fewer initial tools while keeping every specialist tool reachable",()=>{
 const onToolChange=vi.fn();
 const view=render(<PaintToolRail tool="select" guided onToolChange={onToolChange} />);
 expect(screen.queryByRole("button",{name:"paint.tool.bucketFill"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"interface.moreTools"}));
 fireEvent.click(screen.getByRole("menuitem",{name:"paint.tool.bucketFill"}));
 expect(onToolChange).toHaveBeenCalledExactlyOnceWith("bucketFill");
 view.rerender(<PaintToolRail tool="bucketFill" guided onToolChange={onToolChange} />);
 expect(screen.getByRole("button",{name:"paint.tool.bucketFill"}).getAttribute("aria-pressed")).toBe("true");
});
