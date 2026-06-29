// Turn an STL render's per-colour layers into a ready-made page coloring, so
// importing a multi-colour STL into the designer opens the coloring view with
// each line already assigned to its pen colour. Keys must match exactly what the
// ColoringEditor computes: lineKey(densify(worldLine, SEG_MM)).
import type { ColoringColor, PageColoring } from "../api";
import { densify, lineKey } from "../paint/coloring";
import type { Pt } from "../paint/geometry";
import type { StlComputeResult } from "./compute";

// Must match ColoringEditor's SEG_MM.
const SEG_MM = 2.5;
const ALL: ColoringColor[] = ["black", "red", "blue", "green"];

function asColor(c: string): ColoringColor {
  return (ALL as string[]).includes(c) ? (c as ColoringColor) : "black";
}

/** Per-line colour assignments, or null when not worth it (single colour). */
export function stlColoring(result: StlComputeResult): PageColoring | null {
  const assignments: Record<string, (ColoringColor | null)[]> = {};
  const used: ColoringColor[] = [];
  for (const layer of result.layers) {
    const color = asColor(layer.color);
    for (const line of layer.polylines) {
      const dense = densify(line as Pt[], SEG_MM);
      if (dense.length < 2) continue;
      assignments[lineKey(dense)] = new Array(dense.length - 1).fill(color);
      if (!used.includes(color)) used.push(color);
    }
  }
  if (used.length < 2) return null; // only meaningful for multi-colour imports
  const order: ColoringColor[] = [...used, ...ALL.filter((c) => !used.includes(c))];
  return { assignments, order };
}
