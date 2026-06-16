// Turns a parsed Markdown document into a vertical stack of `text` scene
// objects that flow down the page. Each block becomes one text object (with
// internal line breaks from word-wrapping); all objects share a groupId so the
// result moves as one unit while staying individually editable.

import type { SceneObject } from "../api";
import { bounds, type Pt } from "../paint/geometry";
import { type TextFont } from "../paint/text";
import { textGeometryAsync } from "../paint/sceneObjects";
import { DEFAULT_VECTOR_STYLE } from "../paint/styling";
import { blockPlainText, type Block } from "./parse";

export interface LayoutOptions {
  font: TextFont;
  /** Paragraph/body text height in mm; headings scale up from this. */
  baseSize: number;
  /** Wrap width in mm for body text (the column the text flows into). */
  columnWidthMm: number;
  /** Vertical gap between blocks in mm. */
  paragraphGap: number;
  /** Cursive only: connect words across spaces into one baseline flourish. */
  connectSpaces?: boolean;
}

export interface LayoutResult {
  objects: SceneObject[];
  width: number;
  height: number;
}

const HEADING_SCALE: Record<Block["kind"], number> = {
  h1: 2,
  h2: 1.6,
  h3: 1.3,
  p: 1,
  li: 1,
};

/** Average glyph advance as a fraction of the em (size), used only to estimate
 * how many characters fit a column. "block" is monospaced at one em; the
 * proportional single-line "sans" averages roughly half an em. */
export function advanceEm(font: TextFont): number {
  return font === "block" ? 1 : 0.55;
}

/** Heading/body height in mm for a block. */
export function blockSize(baseSize: number, kind: Block["kind"]): number {
  return baseSize * HEADING_SCALE[kind];
}

/** Max characters that fit into a column of the given mm width at a font size. */
export function columnChars(columnWidthMm: number, size: number, font: TextFont): number {
  return Math.max(1, Math.floor(columnWidthMm / Math.max(0.1, size * advanceEm(font))));
}

/** Greedy word-wrap to a maximum character count; long words are hard-split. */
export function wrapText(text: string, maxChars: number): string[] {
  const limit = Math.max(1, maxChars);
  const lines: string[] = [];
  let current = "";
  const push = () => {
    lines.push(current);
    current = "";
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    // Hard-split words that can never fit a single line.
    while (w.length > limit) {
      if (current) push();
      lines.push(w.slice(0, limit));
      w = w.slice(limit);
    }
    if (!current) current = w;
    else if (current.length + 1 + w.length <= limit) current += ` ${w}`;
    else {
      push();
      current = w;
    }
  }
  if (current) push();
  return lines.length ? lines : [""];
}

/** Wrap a block's plain text (incl. list prefix) into display lines. Hard line
 * breaks (\n, from single newlines in the source) are kept; each resulting line
 * is word-wrapped to the column independently. */
export function blockLines(block: Block, opts: LayoutOptions): string[] {
  const size = blockSize(opts.baseSize, block.kind);
  const max = columnChars(opts.columnWidthMm, size, opts.font);
  return blockPlainText(block).split("\n").flatMap((line) => wrapText(line, max));
}

const localBounds = (local: Pt[][]) => bounds(local.flat());

/** Build the stacked text objects for a Markdown document. Async because
 * outline fonts are rendered by the backend. Objects are positioned in a local
 * block space whose top-left is (0,0); the caller places/scales the group. */
export async function layoutMarkdown(
  blocks: Block[],
  opts: LayoutOptions,
  groupId: string,
  fallbackText = "Text"
): Promise<LayoutResult> {
  const objects: SceneObject[] = [];
  let yCursor = 0;
  let maxRight = 0;

  for (const block of blocks) {
    const size = blockSize(opts.baseSize, block.kind);
    const text = blockLines(block, opts).join("\n");
    const mode = "single-line";
    const { local } = await textGeometryAsync(text, size, opts.font, fallbackText, opts.connectSpaces);
    // localize() centers geometry on its centroid, so bounds are symmetric.
    const [x0, y0, x1, y1] = localBounds(local);
    const halfW = (x1 - x0) / 2;
    const halfH = (y1 - y0) / 2;
    // Left-align: the block's left edge sits at x=0, its top at yCursor.
    objects.push({
      id: crypto.randomUUID(),
      type: "text",
      data: { text, mode, size, font: opts.font, basePolylines: local, style: DEFAULT_VECTOR_STYLE },
      cachedPolylines: local,
      transform: { x: halfW, y: yCursor + halfH, rotation: 0, scale: 1 },
      groupId,
      plotted: false,
    });
    maxRight = Math.max(maxRight, halfW * 2);
    yCursor += halfH * 2 + opts.paragraphGap;
  }

  const height = Math.max(0, yCursor - opts.paragraphGap);
  return { objects, width: maxRight, height };
}

/** Translate (and optionally uniformly scale) a group of objects in place,
 * returning new objects. Scaling is about the origin (0,0). */
export function placeObjects(objects: SceneObject[], dx: number, dy: number, scale = 1): SceneObject[] {
  return objects.map((obj) => {
    const t = obj.transform ?? { x: 0, y: 0, rotation: 0, scale: 1 };
    return {
      ...obj,
      transform: {
        ...t,
        x: t.x * scale + dx,
        y: t.y * scale + dy,
        scale: t.scale * scale,
      },
    };
  });
}
