import { expect, it } from "vitest";
import type { SceneObject } from "../../../api";
import { bounds, IDENTITY, transformPolylines, type Pt } from "./geometry";
import { fitPageObjects } from "./fitPage";

const world = (object: SceneObject) => transformPolylines(object.cachedPolylines as Pt[][], object.transform ?? IDENTITY).flat();

it("fits rotated objects together while preserving nonuniform scales and their mask alignment", () => {
  const objects: SceneObject[] = [
    { id: "a", type: "line", cachedPolylines: [[[-10, -20], [10, 20]]],
      transform: { x: 40, y: -20, rotation: Math.PI / 2, scale: 2, scaleX: -3, scaleY: 0.5 } },
    { id: "b", type: "line", cachedPolylines: [[[-20, -10], [20, 10]]],
      transform: { x: 130, y: 70, rotation: Math.PI / 4, scale: 1, scaleX: 2, scaleY: 0.75 } },
    { id: "mask", type: "mask-rect", cachedPolylines: [[[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]]],
      transform: { x: 40, y: -20, rotation: Math.PI / 2, scale: 2 } },
    { id: "printed", type: "line", plotted: true, cachedPolylines: [[[-2000, -2000], [2000, 2000]]] },
  ];
  const original = structuredClone(objects);
  const [x0, y0, x1, y1] = bounds(objects.slice(0, 2).flatMap(world));
  const factor = 80 / (x1 - x0);
  expect(factor).toBeLessThan(100 / (y1 - y0));
  const fitted = fitPageObjects(objects, 80, 100)!;
  const [nx0, ny0, nx1, ny1] = bounds(fitted.slice(0, 2).flatMap(world));
  expect(nx0).toBeCloseTo(0);
  expect(nx1).toBeCloseTo(80);
  expect(ny0).toBeCloseTo(0);
  expect(ny1).toBeLessThanOrEqual(100);

  const offsetX = nx0 - x0 * factor, offsetY = ny0 - y0 * factor;
  for (let i = 0; i < objects.length; i++) {
    if (objects[i].plotted) { expect(fitted[i]).toBe(objects[i]); continue; }
    const before = world(objects[i]), after = world(fitted[i]);
    before.forEach(([x, y], point) => {
      expect(after[point][0]).toBeCloseTo(x * factor + offsetX);
      expect(after[point][1]).toBeCloseTo(y * factor + offsetY);
    });
    expect(fitted[i].cachedPolylines).toBe(objects[i].cachedPolylines);
    expect(fitted[i].transform!.rotation).toBe(objects[i].transform?.rotation ?? 0);
  }
  expect(fitted[0].transform!.scaleX! / fitted[0].transform!.scaleY!).toBe(-6);
  expect(fitted[1].transform!.scaleX! / fitted[1].transform!.scaleY!).toBeCloseTo(2 / 0.75);
  expect(objects).toEqual(original);
});

it("returns null when the drawing already fits or has no remaining drawable lines", () => {
  const objects: SceneObject[] = [{ id: "line", type: "line", cachedPolylines: [[[8.76, 0], [130, 205]]] }];
  expect(fitPageObjects(objects, 141.8, 205)).toBeNull();
  expect(objects[0].transform).toBeUndefined();
  expect(fitPageObjects([], 141.8, 205)).toBeNull();
  expect(fitPageObjects([{ ...objects[0], plotted: true }], 141.8, 205)).toBeNull();
});
