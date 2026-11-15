import { describe, expect, it } from "vitest";
import type { SceneObject } from "../../../api";
import { imageBlankMargins, resetImageBlankEdges, trimImageBlankEdges } from "./imageTrim";
import { sourcePageFrame } from "./sourcePage";

const paths = [[[-80, -50], [-40, -20]]];
const image: SceneObject = {
  id: "xopp-page", type: "image", cachedPolylines: paths,
  transform: { x: 100, y: 100, scale: 0.5, rotation: 0 },
  data: { sourcePage: { width: 210, height: 148 }, basePolylines: paths },
};

describe("image blank margins", () => {
  it("measures page whitespace in placed millimetres", () => {
    expect(imageBlankMargins(image)).toEqual({ left: 12.5, right: 72.5, top: 12, bottom: 47 });
  });

  it("trims individual sides without changing paths or placement and can reset", () => {
    const left = trimImageBlankEdges(image, ["left"]);
    expect(sourcePageFrame(left!)?.[0]).toEqual([[-80, -74], [105, -74], [105, 74], [-80, 74]]);
    expect(left?.cachedPolylines).toBe(paths);
    expect(left?.transform).toBe(image.transform);
    expect(imageBlankMargins(left!)?.left).toBe(0);
    expect(resetImageBlankEdges(left!)?.data?.sourcePage).toEqual({ width: 210, height: 148 });
  });

  it("keeps a selectable frame around a horizontal or vertical line", () => {
    const thin = { ...image, cachedPolylines: [[[-105, -74], [-105, -74]]] };
    const trimmed = trimImageBlankEdges(thin, ["left", "right", "top", "bottom"]);
    const frame = sourcePageFrame(trimmed!)![0];
    expect(frame[1][0] - frame[0][0]).toBeCloseTo(0.1);
    expect(frame[2][1] - frame[1][1]).toBeCloseTo(0.1);
    expect(frame[0][0]).toBe(-105);
    expect(frame[0][1]).toBe(-74);
  });

  it("does not trim an image whose frame is already content-tight", () => {
    const ordinary = { ...image, data: { basePolylines: paths } };
    expect(imageBlankMargins(ordinary)).toBeNull();
    expect(trimImageBlankEdges(ordinary, ["left"])).toBeNull();
  });
});
