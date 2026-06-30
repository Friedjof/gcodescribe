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

/** All variants of a glyph (in order), or [] when the key is absent/empty. */
export function glyphVariants(doc: StrokeFontDocument | null, key: string): StrokeVariant[] {
  return doc?.glyphs.find((g) => g.key === key)?.variants ?? [];
}

/** Strokes of the variant at `index`, or [] when absent. */
export function variantStrokes(
  doc: StrokeFontDocument | null,
  key: string,
  index: number
): Stroke[] {
  return glyphVariants(doc, key)[index]?.strokes ?? [];
}

/** Strokes of a glyph's first variant, or [] when the key is absent/empty. */
export function glyphStrokes(doc: StrokeFontDocument | null, key: string): Stroke[] {
  return variantStrokes(doc, key, 0);
}

/** Advance of the variant at `index`, falling back to the glyph-level value. */
export function variantAdvance(
  doc: StrokeFontDocument | null,
  key: string,
  index: number
): number | undefined {
  const glyph = doc?.glyphs.find((g) => g.key === key);
  return glyph?.variants[index]?.advance ?? glyph?.advance;
}

/** Left side bearing of the variant at `index`, falling back to the glyph. */
export function variantSpacingBefore(
  doc: StrokeFontDocument | null,
  key: string,
  index: number
): number | undefined {
  const glyph = doc?.glyphs.find((g) => g.key === key);
  return glyph?.variants[index]?.spacingBefore ?? glyph?.spacingBefore;
}

export function hasGlyph(doc: StrokeFontDocument | null, key: string): boolean {
  return !!doc?.glyphs.some((g) => g.key === key);
}

/** Apply strokes and (when provided) side bearings to a variant. */
function variantWith(
  variant: StrokeVariant,
  strokes: Stroke[],
  advance?: number,
  spacingBefore?: number
): StrokeVariant {
  const next: StrokeVariant = { ...variant, strokes };
  if (advance !== undefined) next.advance = advance;
  if (spacingBefore !== undefined) next.spacingBefore = spacingBefore;
  return next;
}

/**
 * Insert or update the glyph for `key`, replacing its `variants` outright while
 * preserving metadata (label/tags/createdAt) when the key already exists. The
 * glyph order stays stable. Most callers should reach for the variant-aware
 * helpers below; this is the low-level builder they share.
 */
function writeGlyph(
  doc: StrokeFontDocument,
  key: string,
  variants: StrokeVariant[]
): StrokeFontDocument {
  const now = new Date().toISOString();
  const existing = doc.glyphs.find((g) => g.key === key);
  const glyph: StrokeGlyph = {
    key,
    type: existing?.type ?? inferGlyphType(key),
    label: existing?.label ?? key,
    tags: existing?.tags ?? [],
    // Glyph-level side bearings are legacy fallbacks only; kept as-is for older
    // fonts. New values live on the variants.
    spacingBefore: existing?.spacingBefore,
    advance: existing?.advance,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    variants: variants.length ? variants : [strokesToVariant([])],
  };
  const glyphs = existing
    ? doc.glyphs.map((g) => (g.key === key ? glyph : g))
    : [...doc.glyphs, glyph];
  return { ...doc, glyphs };
}

/**
 * Insert or replace the glyph for `key` with a single variant holding `strokes`,
 * discarding any other variants. Kept for callers that only need the primary
 * shape; the editor saves through `upsertGlyphVariant`.
 */
export function upsertGlyph(
  doc: StrokeFontDocument,
  key: string,
  strokes: Stroke[],
  advance?: number,
  spacingBefore?: number
): StrokeFontDocument {
  return writeGlyph(doc, key, [variantWith(strokesToVariant(strokes), strokes, advance, spacingBefore)]);
}

/**
 * Insert or replace only the variant at `index` with `strokes` (and its side
 * bearings), leaving the other variants (and their ids/weights) untouched. An
 * `index` past the end appends a new variant. A brand-new glyph is created with
 * a single variant.
 */
export function upsertGlyphVariant(
  doc: StrokeFontDocument,
  key: string,
  index: number,
  strokes: Stroke[],
  advance?: number,
  spacingBefore?: number
): StrokeFontDocument {
  const variants = glyphVariants(doc, key);
  const existing = variants[index];
  const next = variantWith(existing ?? strokesToVariant(strokes), strokes, advance, spacingBefore);
  const list =
    index >= 0 && index < variants.length
      ? variants.map((v, i) => (i === index ? next : v))
      : [...variants, next];
  return writeGlyph(doc, key, list);
}

/** Append a fresh variant (optionally seeded with `strokes`) to an existing glyph. */
export function addVariant(
  doc: StrokeFontDocument,
  key: string,
  strokes: Stroke[] = []
): StrokeFontDocument {
  const variants = glyphVariants(doc, key);
  return writeGlyph(doc, key, [...variants, strokesToVariant(strokes)]);
}

/** Remove the variant at `index`. The last remaining variant is never removed. */
export function removeVariant(
  doc: StrokeFontDocument,
  key: string,
  index: number
): StrokeFontDocument {
  const variants = glyphVariants(doc, key);
  if (variants.length <= 1) return doc;
  return writeGlyph(
    doc,
    key,
    variants.filter((_, i) => i !== index)
  );
}

/** Set the selection `weight` of the variant at `index` (clamped to >= 0). */
export function setVariantWeight(
  doc: StrokeFontDocument,
  key: string,
  index: number,
  weight: number
): StrokeFontDocument {
  const variants = glyphVariants(doc, key);
  if (!variants[index]) return doc;
  const safe = Number.isFinite(weight) ? Math.max(0, weight) : 1;
  return writeGlyph(
    doc,
    key,
    variants.map((v, i) => (i === index ? { ...v, weight: safe } : v))
  );
}

export function removeGlyph(doc: StrokeFontDocument, key: string): StrokeFontDocument {
  return { ...doc, glyphs: doc.glyphs.filter((g) => g.key !== key) };
}
