// Stroke fonts: user-drawn handwriting stored as plottable stroke data.
// These mirror the backend documents in plotter/stroke_fonts/model.py. Both the
// raw pointer capture (`rawPoints`) and the smoothed/plotter-ready `points` are
// kept so a stroke can be re-stabilized later without losing the original input.

export type StrokeGlyphType = "character" | "sequence" | "ligature" | "word" | "symbol";

export interface StrokePoint {
  x: number;
  y: number;
  /** Time in ms relative to the start of the variant. */
  t?: number;
  pressure?: number;
  /** Computed pen speed, used to drive variable plotter feedrate. */
  speed?: number;
  pointerType?: string;
}

export interface Stroke {
  id: string;
  rawPoints: StrokePoint[];
  points: StrokePoint[];
  processing?: Record<string, unknown>;
  speedProfile?: Record<string, unknown>;
}

export interface StrokePoint2D {
  x: number;
  y: number;
}

export interface StrokeVariant {
  id: string;
  weight: number;
  strokes: Stroke[];
  context?: Record<string, unknown>;
  bounds?: Record<string, number>;
  entryPoint?: StrokePoint2D;
  exitPoint?: StrokePoint2D;
  capture?: Record<string, unknown>;
}

export interface StrokeGlyph {
  key: string;
  type: StrokeGlyphType;
  label: string;
  variants: StrokeVariant[];
  tags: string[];
  spacingBefore?: number;
  advance?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StrokeFontMetrics {
  em: number;
  baseline: number;
  xHeight: number;
  capHeight: number;
  ascender: number;
  descender: number;
  defaultAdvance: number;
  wordSpacing: number;
}

export interface StrokeFontDocument {
  schemaVersion: number;
  id: string;
  label: string;
  kind: "stroke";
  units: string;
  metrics: StrokeFontMetrics;
  glyphs: StrokeGlyph[];
  coverage: { targetSet: string };
  createdAt: string;
  updatedAt: string;
}

export interface StrokeFontSummary {
  id: string;
  label: string;
  kind: "stroke";
  glyphCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StrokeFontListResponse {
  strokeFonts: StrokeFontSummary[];
}

export interface StrokeFontResponse {
  strokeFont: StrokeFontDocument;
}
