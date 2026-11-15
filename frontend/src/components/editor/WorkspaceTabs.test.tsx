// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import WorkspaceTabs from "./WorkspaceTabs";
import { workspaceById, type WorkspaceId } from "../../interface/workspaces";
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
it("provides ordered editor tabs with roving keyboard focus", () => {
  function Tabs() {
    const [active, setActive] = useState<WorkspaceId>("paint");
    return <WorkspaceTabs workspaces={["start", "paint", "games"].map(id => workspaceById(id as WorkspaceId))} active={active} onChange={setActive} onCustomize={vi.fn()} />;
  }
  render(<Tabs />);
  const draw = screen.getByRole("tab", { name: "workspace.paint" });
  fireEvent.keyDown(draw, { key: "ArrowRight" });
  const templates = screen.getByRole("tab", { name: "workspace.games" });
  expect(templates.getAttribute("aria-selected")).toBe("true"); expect(document.activeElement).toBe(templates);
  fireEvent.keyDown(templates, { key: "Home" });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "workspace.start" }));
});
