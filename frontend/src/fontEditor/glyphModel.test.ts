import { describe, expect, it } from "vitest";
import {
  glyphStrokes,
  hasGlyph,
  inferGlyphType,
  newStroke,
  removeGlyph,
  upsertGlyph,
} from "./glyphModel";
import type { StrokeFontDocument } from "../api";

function doc(): StrokeFontDocument {
  return {
    schemaVersion: 1,
    id: "stroke-test",
    label: "Test",
    kind: "stroke",
    units: "em",
    metrics: {
      em: 1000,
      baseline: 0,
      xHeight: 460,
      capHeight: 700,
      ascender: 780,
      descender: -230,
      defaultAdvance: 560,
      wordSpacing: 280,
    },
    glyphs: [],
    coverage: { targetSet: "latin-basic-en-v1" },
    createdAt: "2026-06-29T00:00:00Z",
    updatedAt: "2026-06-29T00:00:00Z",
  };
}

const stroke = () =>
  newStroke(
    [{ x: 0, y: 0, t: 0 }, { x: 5, y: 5, t: 8 }],
    [{ x: 0, y: 0, t: 0 }, { x: 5, y: 5, t: 8 }]
  );

describe("glyphModel", () => {
  it("infers glyph type from key length", () => {
    expect(inferGlyphType("a")).toBe("character");
    expect(inferGlyphType("ff")).toBe("sequence");
    expect(inferGlyphType("🙂")).toBe("character");
  });

  it("upserts a new glyph with one variant", () => {
    const next = upsertGlyph(doc(), "a", [stroke()]);
    expect(next.glyphs).toHaveLength(1);
    expect(next.glyphs[0].key).toBe("a");
    expect(next.glyphs[0].variants[0].strokes).toHaveLength(1);
  });

  it("replaces an existing glyph in place and preserves createdAt", () => {
    const first = upsertGlyph(doc(), "a", [stroke()]);
    const createdAt = first.glyphs[0].createdAt;
    const second = upsertGlyph(first, "a", [stroke(), stroke()]);
    expect(second.glyphs).toHaveLength(1);
    expect(second.glyphs[0].variants[0].strokes).toHaveLength(2);
    expect(second.glyphs[0].createdAt).toBe(createdAt);
  });

  it("reads strokes back and reports presence", () => {
    const next = upsertGlyph(doc(), "a", [stroke()]);
    expect(hasGlyph(next, "a")).toBe(true);
    expect(hasGlyph(next, "b")).toBe(false);
    expect(glyphStrokes(next, "a")).toHaveLength(1);
    expect(glyphStrokes(next, "b")).toEqual([]);
  });

  it("removes a glyph", () => {
    const next = removeGlyph(upsertGlyph(doc(), "a", [stroke()]), "a");
    expect(next.glyphs).toHaveLength(0);
  });
});
