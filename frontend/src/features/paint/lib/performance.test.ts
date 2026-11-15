import { expect, it } from "vitest";
import { bounds, cacheGeometryHull, IDENTITY, objectWorldBounds, toMultiPath, transformPolylines, type Pt } from "./geometry";
import { computeGeometry } from "./geometryWork";
import { convexHull, packLines, unpackLines } from "./geometryTransfer";
import { previewPath } from "./geometryTasks";
import { buildStyledPolylines, DEFAULT_VECTOR_STYLE } from "./styling";
import { cloneObjects } from "./sceneObjects";
import { trimHistory } from "./history";
import type { SceneObject } from "../../../api";

it.each([20000, 100000, 400000])("keeps %i source points exact while displaying a bounded interaction path", (count) => {
  const lines: Pt[][] = Array.from({ length: 100 }, (_, row) => Array.from({ length: count / 100 }, (_, i) => [i * .123456789, row + Math.sin(i)]));
  const packed = packLines(lines);
  expect(unpackLines(packed)).toEqual(lines);
  const before = JSON.stringify(lines);
  const sample = previewPath(lines);
  expect((sample.match(/[ML]/g) ?? []).length).toBeLessThanOrEqual(5000);
  expect(JSON.stringify(lines)).toBe(before);
  const full = computeGeometry({ kind: "path", lines }) as { path: string; hull: Pt[] };
  expect(full.path).toBe(toMultiPath(lines));
  cacheGeometryHull(lines, full.hull);
  const transform = { x: 27, y: 52, rotation: 1.24, scale: .8, scaleX: -1.3, scaleY: .7 };
  const expected = bounds(transformPolylines(lines, transform).flat());
  objectWorldBounds(lines, transform).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 9));
}, 20000);

it("worker styling and erasing leave the input immutable and match the original geometry functions", () => {
  const lines: Pt[][] = [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]];
  const before = structuredClone(lines);
  const style = { ...DEFAULT_VECTOR_STYLE, fill: { ...DEFAULT_VECTOR_STYLE.fill, enabled: true } };
  expect(computeGeometry({ kind: "style", lines, style })).toEqual(buildStyledPolylines(lines, style));
  expect(computeGeometry({ kind: "erase", lines, transform: IDENTITY, path: [[10, -1], [10, 21]], radius: 1, mode: "line" })).toEqual([]);
  expect(lines).toEqual(before);
});

it("shares immutable geometry between undo frames and bounds history by steps and bytes", () => {
  const geometry = [Array.from({ length: 20000 }, (_, i) => [i, i])];
  const object = { id: "image", type: "image", cachedPolylines: geometry } as SceneObject;
  const undo = Array.from({ length: 120 }, () => cloneObjects([object]));
  expect(undo[0][0].cachedPolylines).toBe(geometry);
  trimHistory(undo, [], 2 * 1024 * 1024);
  expect(undo).toHaveLength(100);
  trimHistory(undo, [], 100);
  expect(undo).toHaveLength(0);
});

it("convex hull handles empty and repeated points", () => {
  expect(convexHull([])).toEqual([]);
  const lines: Pt[][] = [[[0, 0], [0, 0], [1, 1], [1, 1], [2, 2]]];
  expect(convexHull(lines)).toEqual([[0, 0], [2, 2]]);
});
