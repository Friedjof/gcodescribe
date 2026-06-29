import type {
  Stroke,
  StrokeFontDocument,
  StrokeGlyph,
  StrokeGlyphType,
  StrokePoint,
  StrokeVariant,
} from "../api";

// Pure builders/queries for editing a stroke-font document. The backend
// re-validates and may re-id on save, so client ids only need to be locally
// unique within the editing session.

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A single Unicode char is a `character`; anything longer is a `sequence`. */
export function inferGlyphType(key: string): StrokeGlyphType {
  return [...key].length === 1 ? "character" : "sequence";
}

export function newStroke(rawPoints: StrokePoint[], points: StrokePoint[]): Stroke {
  return { id: uid("stroke"), rawPoints, points };
}

/** Shift a stroke by (dx, dy) in em units (both raw and processed points). */
export function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  const shift = (p: StrokePoint): StrokePoint => ({ ...p, x: p.x + dx, y: p.y + dy });
  return {
    ...stroke,
    rawPoints: stroke.rawPoints.map(shift),
    points: stroke.points.map(shift),
  };
}

/** Scale a stroke around an em-space origin (both raw and processed points). */
export function scaleStroke(stroke: Stroke, factor: number, origin = { x: 0, y: 0 }): Stroke {
  const scale = (p: StrokePoint): StrokePoint => ({
    ...p,
    x: origin.x + (p.x - origin.x) * factor,
    y: origin.y + (p.y - origin.y) * factor,
  });
  return {
    ...stroke,
    rawPoints: stroke.rawPoints.map(scale),
    points: stroke.points.map(scale),
  };
}

export function strokesToVariant(strokes: Stroke[]): StrokeVariant {
  return { id: uid("var"), weight: 1, strokes };
}

/** Strokes of a glyph's first variant, or [] when the key is absent/empty. */
export function glyphStrokes(doc: StrokeFontDocument | null, key: string): Stroke[] {
  const glyph = doc?.glyphs.find((g) => g.key === key);
  return glyph?.variants[0]?.strokes ?? [];
}

export function glyphAdvance(doc: StrokeFontDocument | null, key: string): number | undefined {
  return doc?.glyphs.find((g) => g.key === key)?.advance;
}

export function glyphSpacingBefore(doc: StrokeFontDocument | null, key: string): number | undefined {
  return doc?.glyphs.find((g) => g.key === key)?.spacingBefore;
}

export function hasGlyph(doc: StrokeFontDocument | null, key: string): boolean {
  return !!doc?.glyphs.some((g) => g.key === key);
}

/**
 * Insert or replace the glyph for `key` with a single variant holding `strokes`.
 * Existing metadata (label/tags/createdAt) is preserved when the key already
 * exists; the glyph order stays stable.
 */
export function upsertGlyph(
  doc: StrokeFontDocument,
  key: string,
  strokes: Stroke[],
  advance?: number,
  spacingBefore?: number
): StrokeFontDocument {
  const now = new Date().toISOString();
  const existing = doc.glyphs.find((g) => g.key === key);
  const glyph: StrokeGlyph = {
    key,
    type: existing?.type ?? inferGlyphType(key),
    label: existing?.label ?? key,
    tags: existing?.tags ?? [],
    spacingBefore: spacingBefore ?? existing?.spacingBefore,
    advance: advance ?? existing?.advance,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    variants: [strokesToVariant(strokes)],
  };
  const glyphs = existing
    ? doc.glyphs.map((g) => (g.key === key ? glyph : g))
    : [...doc.glyphs, glyph];
  return { ...doc, glyphs };
}

export function removeGlyph(doc: StrokeFontDocument, key: string): StrokeFontDocument {
  return { ...doc, glyphs: doc.glyphs.filter((g) => g.key !== key) };
}
