import { expect, it } from "vitest";
import type { Calibration } from "../api/types/calibration";
import { paperRect } from "./paperGeometry";

const withCorners = (corners: Calibration["paper_corners"]) => ({ paper_corners: corners }) as Calibration;
it("derives a paper preview from two opposing corners or four skewed corners", () => {
  expect(paperRect(withCorners({ bl: [20, 30], tr: [180, 190] }))).toEqual([20, 30, 160, 160]);
  expect(paperRect(withCorners({ bl: [25, 30], br: [180, 35], tr: [175, 190], tl: [20, 180] }))).toEqual([20, 30, 160, 160]);
});
it("rejects missing or degenerate outlines and ignores malformed legacy points", () => {
  expect(paperRect({} as Calibration)).toBeNull();
  expect(paperRect(withCorners({ bl: [10, 10] }))).toBeNull();
  expect(paperRect(withCorners({ bl: [10, 10], tr: [10.5, 30] }))).toBeNull();
  expect(paperRect(withCorners({ bl: [10, 10], tr: [11, 11] }))).toEqual([10, 10, 1, 1]);
  expect(paperRect(withCorners({ bl: [10, 10], tr: [20, 30], invalid: null } as unknown as Calibration["paper_corners"]))).toEqual([10, 10, 10, 20]);
});
