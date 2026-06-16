import { describe, expect, it } from "vitest";
import type { SceneObject } from "../api";
import { parseMarkdown } from "./parse";
import { advanceEm, blockLines, blockSize, columnChars, placeObjects, wrapText, type LayoutOptions } from "./layout";

const opts: LayoutOptions = { font: "block", baseSize: 6, columnWidthMm: 60, paragraphGap: 4 };

describe("wrapText", () => {
  it("greedily wraps words to the character limit", () => {
    expect(wrapText("the quick brown fox", 9)).toEqual(["the quick", "brown fox"]);
  });

  it("hard-splits words longer than the limit", () => {
    expect(wrapText("supercalifragilistic", 5)).toEqual(["super", "calif", "ragil", "istic"]);
  });

  it("never returns an empty array", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });
});

describe("blockSize", () => {
  it("scales headings above body text", () => {
    expect(blockSize(6, "h1")).toBe(12);
    expect(blockSize(6, "h2")).toBeCloseTo(9.6);
    expect(blockSize(6, "p")).toBe(6);
  });
});

describe("advanceEm / columnChars", () => {
  it("treats block as monospaced and sans as proportional", () => {
    expect(advanceEm("block")).toBe(1);
    expect(advanceEm("sans")).toBeLessThan(1);
  });

  it("fits more characters into a wider column", () => {
    expect(columnChars(60, 6, "block")).toBe(10);
    expect(columnChars(30, 6, "block")).toBe(5);
  });
});

describe("blockLines", () => {
  it("prefixes list items and wraps to the column", () => {
    const [li] = parseMarkdown("- alpha beta gamma delta");
    // column 60mm / (6mm * 1em) = 10 chars per line
    expect(blockLines(li, opts)).toEqual(["• alpha", "beta gamma", "delta"]);
  });
});

describe("placeObjects", () => {
  const obj = (x: number, y: number, scale = 1): SceneObject => ({
    id: "o",
    type: "text",
    transform: { x, y, rotation: 0, scale },
  });

  it("translates without scaling by default", () => {
    const [out] = placeObjects([obj(5, 10)], 2, 3);
    expect(out.transform).toMatchObject({ x: 7, y: 13, scale: 1 });
  });

  it("scales positions and object scale about the origin", () => {
    const [out] = placeObjects([obj(10, 20, 1)], 0, 0, 0.5);
    expect(out.transform).toMatchObject({ x: 5, y: 10, scale: 0.5 });
  });
});
