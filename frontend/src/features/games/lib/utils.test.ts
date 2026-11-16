import { describe, expect, it } from "vitest";
import { mergeAxisAlignedSegments } from "./utils";

describe("mergeAxisAlignedSegments", () => {
  it("joins adjacent horizontal and vertical segments", () => {
    expect(mergeAxisAlignedSegments([
      [[0, 0], [1, 0]],
      [[1, 0], [2, 0]],
      [[4, 1], [4, 2]],
      [[4, 2], [4, 3]],
    ])).toEqual([
      [[0, 0], [2, 0]],
      [[4, 1], [4, 3]],
    ]);
  });

  it("keeps diagonal and disconnected segments separate", () => {
    expect(mergeAxisAlignedSegments([
      [[0, 0], [1, 1]],
      [[0, 2], [1, 2]],
      [[3, 2], [4, 2]],
    ])).toEqual([
      [[0, 0], [1, 1]],
      [[0, 2], [1, 2]],
      [[3, 2], [4, 2]],
    ]);
  });
});

it("keeps a template's random code when it is inserted on the canvas", async () => {
  const { templateObject } = await import("./utils");
  expect(templateObject("maze", [[[0, 0], [1, 1]]], 1234).data).toEqual({ template: "maze", seed: "01234" });
  expect(templateObject("osmMap", [[[0, 0], [1, 1]]]).data).toEqual({ template: "osmMap" });
});
