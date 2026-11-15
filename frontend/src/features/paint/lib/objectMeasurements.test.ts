import { expect, it } from "vitest";
import type { Calibration, SceneObject } from "../../../api";
import { IDENTITY, objectWorldBounds } from "./geometry";
import { measurementFrame, measurementTransform, objectMeasurements } from "./objectMeasurements";
const calibration = { plot_width: 100, plot_height: 80 } as Calibration;
const object: SceneObject = { id: "a", type: "rect", transform: { ...IDENTITY, x: 40, y: 30 },
  cachedPolylines: [[[-10, -5], [10, 5]]] };
it("uses the rotated bounding-box origin for X/Y and unrotated dimensions for size", () => {
  expect(objectMeasurements({ ...object, transform: { ...object.transform!, rotation: Math.PI / 2 } })).toMatchObject({
    x: 35, y: 20, width: 20, height: 10, rotation: 90,
  });
});
it("sets exact X/Y positions without changing size or rotation", () => {
  const transform = measurementTransform(object, { kind: "position", axis: "x", value: 12.3456789 }, calibration)!;
  expect(objectWorldBounds(measurementFrame(object), transform)[0]).toBeCloseTo(12.3456789);
  expect(transform.scale).toBe(1); expect(transform.rotation).toBe(0);
});
it("keeps requested dimensions exact while shifting an otherwise fitting object into the plot", () => {
  const transform = measurementTransform(object, { kind: "size", axis: "width", value: 90, linked: true }, calibration)!;
  expect(transform.scaleX).toBeCloseTo(4.5); expect(transform.scaleY).toBeCloseTo(4.5);
  const bounds = objectWorldBounds(measurementFrame(object), transform);
  expect(bounds[0]).toBeCloseTo(0); expect(bounds[2]).toBeCloseTo(90);
});
it("rejects oversized dimensions rather than silently shrinking the entered number", () => {
  expect(measurementTransform(object, { kind: "size", axis: "width", value: 120, linked: true }, calibration)).toBeNull();
  expect(measurementTransform(object, { kind: "position", axis: "x", value: 95 }, calibration)).toBeNull();
});
it("rejects a rotation that cannot fit without resizing", () => {
  const wide = { ...object, transform: { ...object.transform!, x: 50, scaleX: 4.5, scaleY: 1 } };
  expect(measurementTransform(wide, { kind: "rotation", value: 90 }, calibration)).toBeNull();
});
it("keeps mirrored dimensions and imported page proportions", () => {
  const paper = { ...object, transform: { ...object.transform!, scaleX: -1 }, data: { sourcePage: { width: 40, height: 20 } } };
  const transform = measurementTransform(paper, { kind: "size", axis: "width", value: 60, linked: false }, calibration)!;
  expect(transform.scaleX).toBe(-1.5); expect(transform.scaleY).toBe(1.5);
});
it("handles negative angles and treats a full turn as the existing orientation", () => {
  expect(measurementTransform(object, { kind: "rotation", value: -90 }, calibration)?.rotation).toBeCloseTo(Math.PI * 1.5);
  expect(measurementTransform(object, { kind: "rotation", value: 360 }, calibration)?.rotation).toBe(0);
});
