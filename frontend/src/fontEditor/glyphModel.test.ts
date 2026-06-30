import { describe, expect, it } from "vitest";
import {
  addVariant,
  glyphStrokes,
  glyphVariants,
  hasGlyph,
  inferGlyphType,
  newStroke,
  removeGlyph,
  removeVariant,
  setVariantWeight,
  upsertGlyph,
  upsertGlyphVariant,
  variantAdvance,
  variantSpacingBefore,
  variantStrokes,
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

  describe("variants", () => {
    it("adds a variant without touching the first one", () => {
      const base = upsertGlyph(doc(), "a", [stroke()]);
      const next = addVariant(base, "a", [stroke(), stroke()]);
      expect(glyphVariants(next, "a")).toHaveLength(2);
      expect(variantStrokes(next, "a", 0)).toHaveLength(1);
      expect(variantStrokes(next, "a", 1)).toHaveLength(2);
      // First variant's strokes are unchanged.
      expect(glyphStrokes(next, "a")).toEqual(variantStrokes(base, "a", 0));
    });

    it("upserts only the targeted variant and preserves the others' ids/weights", () => {
      const two = addVariant(upsertGlyph(doc(), "a", [stroke()]), "a", [stroke()]);
      const weighted = setVariantWeight(two, "a", 0, 3);
      const v0Id = glyphVariants(weighted, "a")[0].id;
      const v1Id = glyphVariants(weighted, "a")[1].id;
      const next = upsertGlyphVariant(weighted, "a", 1, [stroke(), stroke(), stroke()]);
      const variants = glyphVariants(next, "a");
      expect(variants).toHaveLength(2);
      expect(variants[0].id).toBe(v0Id);
      expect(variants[0].weight).toBe(3);
      expect(variants[1].id).toBe(v1Id); // same variant, new strokes
      expect(variants[1].strokes).toHaveLength(3);
    });

    it("appends a new variant when the index is past the end", () => {
      const base = upsertGlyph(doc(), "a", [stroke()]);
      const next = upsertGlyphVariant(base, "a", 1, [stroke()]);
      expect(glyphVariants(next, "a")).toHaveLength(2);
    });

    it("sets a variant weight, clamping below zero", () => {
      const base = addVariant(upsertGlyph(doc(), "a", [stroke()]), "a");
      expect(glyphVariants(setVariantWeight(base, "a", 1, 4), "a")[1].weight).toBe(4);
      expect(glyphVariants(setVariantWeight(base, "a", 1, -2), "a")[1].weight).toBe(0);
    });

    it("removes a variant but never the last one", () => {
      const two = addVariant(upsertGlyph(doc(), "a", [stroke()]), "a", [stroke()]);
      expect(glyphVariants(removeVariant(two, "a", 0), "a")).toHaveLength(1);
      const one = upsertGlyph(doc(), "a", [stroke()]);
      expect(glyphVariants(removeVariant(one, "a", 0), "a")).toHaveLength(1);
    });

    it("creates a brand-new glyph from upsertGlyphVariant", () => {
      const next = upsertGlyphVariant(doc(), "z", 0, [stroke()]);
      expect(hasGlyph(next, "z")).toBe(true);
      expect(glyphVariants(next, "z")).toHaveLength(1);
    });

    it("stores side bearings per variant, independently", () => {
      let d = upsertGlyphVariant(doc(), "a", 0, [stroke()], 600, 40);
      d = upsertGlyphVariant(d, "a", 1, [stroke()], 720, 10);
      expect(glyphVariants(d, "a")[0].advance).toBe(600);
      expect(glyphVariants(d, "a")[0].spacingBefore).toBe(40);
      expect(glyphVariants(d, "a")[1].advance).toBe(720);
      expect(variantAdvance(d, "a", 1)).toBe(720);
      expect(variantSpacingBefore(d, "a", 1)).toBe(10);
      // Editing variant 0's width must not touch variant 1.
      d = upsertGlyphVariant(d, "a", 0, [stroke()], 650, 40);
      expect(variantAdvance(d, "a", 0)).toBe(650);
      expect(variantAdvance(d, "a", 1)).toBe(720);
    });

    it("falls back to the glyph-level side bearing for legacy variants", () => {
      // Simulate an old font: glyph-level advance, variant without its own.
      const base = upsertGlyph(doc(), "a", [stroke()]);
      const legacy: StrokeFontDocument = {
        ...base,
        glyphs: base.glyphs.map((g) =>
          g.key === "a"
            ? { ...g, advance: 580, variants: [{ ...g.variants[0], advance: undefined }] }
            : g
        ),
      };
      expect(variantAdvance(legacy, "a", 0)).toBe(580);
    });
  });
});
