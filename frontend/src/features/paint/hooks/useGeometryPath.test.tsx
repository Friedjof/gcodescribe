// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { cachedGeometryPath, toMultiPath, type Pt } from "../lib/geometry";
import { useGeometryPath } from "./useGeometryPath";

// Keep background preparation pending to exercise an immediate first gesture.
vi.mock("../lib/geometryTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/geometryTasks")>()),
  preparePath: () => new Promise(() => {}),
}));
afterEach(cleanup);

it("prepares all strokes when zoom starts before the worker finishes and keeps them afterwards", () => {
  const lines: Pt[][] = Array.from({ length: 2500 }, (_, i) => [
    [0, i],
    [10, i],
  ]);
  const before = JSON.stringify(lines);
  const view = renderHook(
    ({ interactive }) => useGeometryPath(lines, interactive),
    { initialProps: { interactive: false } },
  );
  expect(cachedGeometryPath(lines)).toBeUndefined();
  view.rerender({ interactive: true });
  expect((view.result.current.match(/M /g) ?? []).length).toBe(2500);
  expect(view.result.current).toContain("L 10.00 2499.00");
  const exact = view.result.current;
  view.rerender({ interactive: false });
  expect(view.result.current).toBe(exact);
  expect(view.result.current).toBe(toMultiPath(lines));
  expect(JSON.stringify(lines)).toBe(before);
});

it("keeps every point of a prepared curve when switching between idle and interactive views", () => {
  const lines: Pt[][] = [
    Array.from({ length: 12000 }, (_, i) => [i / 30, Math.sin(i / 10)]),
  ];
  const exact = toMultiPath(lines);
  const view = renderHook(
    ({ interactive }) => useGeometryPath(lines, interactive),
    { initialProps: { interactive: false } },
  );
  view.rerender({ interactive: true });
  expect(view.result.current).toBe(exact);
  expect((view.result.current.match(/L /g) ?? []).length).toBe(11999);
});
