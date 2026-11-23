// @vitest-environment jsdom
import { cleanup,fireEvent, render, screen } from "@testing-library/react";
import { afterEach,beforeEach,expect, it, vi } from "vitest";
import Gcode3DOverlay from "./Gcode3DOverlay";

vi.mock("../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./Gcode3D", () => ({ default: ({ showBed,showTravels,showProfile }: { showBed: boolean;showTravels:boolean;showProfile:boolean }) =>
  <div data-testid="path-view" data-show-bed={showBed} data-show-travels={showTravels} data-show-profile={showProfile}/> }));

beforeEach(()=>localStorage.clear());afterEach(cleanup);
it("shows the real bed size in the large view and lets it be hidden", () => {
  const data = { draws: [[[20, 30, 1], [40, 50, 1]]], travels: [],
    bounds: [20, 30, 1, 40, 50, 1] as [number, number, number, number, number, number],
    bed: [220, 180] as [number, number], truncated: false };
  render(<Gcode3DOverlay data={data} onClose={vi.fn()} />);
  const toggle = screen.getByRole("checkbox", { name: "g3d.bed · 220 × 180 mm" });
  expect((toggle as HTMLInputElement).checked).toBe(true);
  expect(screen.getByTestId("path-view").getAttribute("data-show-bed")).toBe("true");
  fireEvent.click(toggle);
  expect((toggle as HTMLInputElement).checked).toBe(false);
  expect(screen.getByTestId("path-view").getAttribute("data-show-bed")).toBe("false");
});

it("persists independent travel and profile-outline switches between previews",()=>{
 const data={draws:[],travels:[],bounds:null,truncated:false,profileOutline:{paper:[],plot:[[0,0,0],[10,0,0]]}};
 const first=render(<Gcode3DOverlay data={data} onClose={vi.fn()}/>);
 fireEvent.click(screen.getByRole("checkbox",{name:"g3d.travels"}));fireEvent.click(screen.getByRole("checkbox",{name:"g3d.profile"}));
 expect(screen.getByTestId("path-view").getAttribute("data-show-travels")).toBe("false");
 expect(screen.getByTestId("path-view").getAttribute("data-show-profile")).toBe("true");
 first.unmount();render(<Gcode3DOverlay data={data} onClose={vi.fn()}/>);
 expect((screen.getByRole("checkbox",{name:"g3d.travels"}) as HTMLInputElement).checked).toBe(false);
 expect((screen.getByRole("checkbox",{name:"g3d.profile"}) as HTMLInputElement).checked).toBe(true);
});
