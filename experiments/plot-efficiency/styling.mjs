/** Diagnostic fixtures against the actual Designer style generator.
 * Run: node --experimental-strip-types experiments/plot-efficiency/styling.mjs
 * Node 22+ is required. All measurements use synthetic object-local mm;
 * no final-size, pen-coverage or physical-print claims are made.
 */
import fs from "node:fs";
import {
  buildStyledPolylines,
  DEFAULT_VECTOR_STYLE,
} from "../../frontend/src/features/paint/lib/styling.ts";

function length(lines) {
  return lines.reduce((sum, line) => sum + line.slice(1).reduce(
    (distance, point, i) => distance + Math.hypot(
      point[0] - line[i][0], point[1] - line[i][1]
    ), 0
  ), 0);
}

function main() {
  const angle = [[[0, 0], [5, 0], [5, 5]]];
  const dashed = buildStyledPolylines(angle, {
    stroke: {
      ...DEFAULT_VECTOR_STYLE.stroke,
      mode: "dashed", dashLength: 10, gapLength: 3,
    },
  });
  const outer = [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]];
  const hole = [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]];
  const filled = buildStyledPolylines([outer, hole], {
    fill: { ...DEFAULT_VECTOR_STYLE.fill, enabled: true, angle: 0, spacing: 2 },
  });
  const hatch = filled.slice(2);
  const crossesHole = hatch.filter((line) => (
    line[0][1] > 5 && line[0][1] < 15
    && Math.min(line[0][0], line[1][0]) < 15
    && Math.max(line[0][0], line[1][0]) > 5
  ));
  const dotted = buildStyledPolylines([[[0, 0], [40, 0]]], {
    stroke: { ...DEFAULT_VECTOR_STYLE.stroke, mode: "dotted" },
  });
  const report = {
    scope: "Synthetic object-local mm; diagnostics, not approved optimized geometry",
    dashed_corner: {
      original: angle,
      actual: dashed,
      original_mm: length(angle),
      actual_mm: length(dashed),
      // Exact distance from omitted vertex (5,0) to output diagonal x=y.
      omitted_corner_distance_to_diagonal_mm: 5 / Math.sqrt(2),
    },
    filled_hole: {
      hatch_lines: hatch.length,
      hatch_lines_crossing_intended_white_hole: crossesHole.length,
      intended_hole_area_mm2: 100,
    },
    dotted_stroke: {
      intended_marks: 11,
      generated_paths: dotted.length,
      draw_mm: length(dotted),
      note: "Current marks are crosses. Replacing them with pen contacts changes their shape.",
    },
  };
  const directory = new URL("./results/", import.meta.url);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(new URL("styling.json", directory), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main();
