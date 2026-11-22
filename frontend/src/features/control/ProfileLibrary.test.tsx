// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import ProfileLibrary from "./ProfileLibrary";
import type { CalibrationProfileSummary } from "../../api";
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
it("marks the project's profile instead of the global default and only selects for editing", () => {
  const base = { archived: false, plot_width: 100, plot_height: 80, origin_x: 0, origin_y: 0, pen_calibrated: true };
  const profiles = [{ ...base, id: "default", name: "Legacy default", active: true },
    { ...base, id: "project", name: "Project profile", active: false }] as CalibrationProfileSummary[];
  const select = vi.fn();
  render(<ProfileLibrary profiles={profiles} selectedId="default" projectProfileId="project" onSelect={select} />);
  expect(screen.getByText("profiles.projectBadge").closest("button")).toHaveTextContent("Project profile");
  expect(screen.queryByText("profiles.activeBadge")).toBeNull();
  expect(screen.queryByRole("button", { name: "profiles.activate" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Project profile/ }));
  expect(select).toHaveBeenCalledExactlyOnceWith("project");
});
