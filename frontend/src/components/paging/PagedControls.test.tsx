// @vitest-environment jsdom
import { Fragment, useState } from "react";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import PagedControls from "./PagedControls";
vi.mock("../../i18n",()=>({useI18n:()=>({t:(key:string)=>key})}));
afterEach(cleanup);
it("keeps parameter values while exposing every field through explicit pages",()=>{
 function Harness(){const [value,setValue]=useState("one");return <PagedControls size={2}><Fragment><input aria-label="First" value={value} onChange={e=>setValue(e.target.value)}/><span>Second</span><span>Third</span></Fragment></PagedControls>}
 render(<Harness/>);fireEvent.change(screen.getByLabelText("First"),{target:{value:"edited"}});
 expect(screen.queryByText("Third")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"paging.next"}));expect(screen.getByText("Third")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"paging.previous"}));expect((screen.getByLabelText("First") as HTMLInputElement).value).toBe("edited");
});
