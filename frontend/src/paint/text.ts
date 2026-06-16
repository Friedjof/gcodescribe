import type { Pt } from "./geometry";

// Plottable fonts. "sans" is a real single-line (single-stroke) font rendered
// by the backend from a vendored OTF/TTF — one thin centreline per glyph, ideal
// for plotting. "block" is the legacy client-side 5x7 fallback.
export type TextFont = "sans" | "hand" | "script" | "block";

export const TEXT_FONTS: { value: TextFont; labelKey: string }[] = [
  { value: "sans", labelKey: "font.sans" },
  { value: "hand", labelKey: "font.hand" },
  { value: "script", labelKey: "font.script" },
  { value: "block", labelKey: "font.drawnBlock" },
];

// Fonts rendered on the backend (vendored single-line files) vs. the local
// 5x7 generator. Server fonts go through api.textPolylines.
const SERVER_FONTS = new Set<TextFont>(["sans", "hand", "script"]);
export const isServerFont = (font: TextFont) => SERVER_FONTS.has(font);

// 5x7 stroke bitmap. Each glyph is drawn as merged horizontal/vertical runs so
// the plotter follows single strokes rather than filling outlines.
const FONT: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01111", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "11110"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
};

function normalizeText(text: string): string {
  return text
    .toUpperCase()
    .replace(/Ä/g, "AE")
    .replace(/Ö/g, "OE")
    .replace(/Ü/g, "UE")
    .replace(/ẞ/g, "SS");
}

function charPolylines(ch: string, x: number, y: number, unit: number): Pt[][] {
  const grid = FONT[ch] ?? FONT["?"];
  const lines: Pt[][] = [];
  // Horizontal runs.
  for (let row = 0; row < grid.length; row++) {
    let col = 0;
    while (col < 5) {
      if (grid[row][col] !== "1") {
        col++;
        continue;
      }
      const start = col;
      while (col + 1 < 5 && grid[row][col + 1] === "1") col++;
      lines.push([[x + start * unit, y + row * unit], [x + (col + 1) * unit, y + row * unit]]);
      col++;
    }
  }
  // Vertical runs (length > 1 only, to avoid duplicating single cells).
  for (let col = 0; col < 5; col++) {
    let row = 0;
    while (row < grid.length) {
      if (grid[row][col] !== "1") {
        row++;
        continue;
      }
      const start = row;
      while (row + 1 < grid.length && grid[row + 1][col] === "1") row++;
      if (row > start) {
        lines.push([[x + col * unit, y + start * unit], [x + col * unit, y + (row + 1) * unit]]);
      }
      row++;
    }
  }
  return lines;
}

export function textWorld(text: string, origin: Pt, heightMm = 12): Pt[][] {
  const unit = heightMm / 7;
  const lines: Pt[][] = [];
  let x = origin[0];
  let y = origin[1];
  for (const ch of normalizeText(text)) {
    if (ch === "\n") {
      x = origin[0];
      y += unit * 9;
      continue;
    }
    lines.push(...charPolylines(ch, x, y, unit));
    x += unit * 7;
  }
  return lines;
}
