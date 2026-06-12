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
