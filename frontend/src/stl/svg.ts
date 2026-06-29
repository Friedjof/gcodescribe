// Serialise plotter polylines (plot mm) to a plain SVG the backend's
// load_svg_drawing() can parse. One SVG per pen colour keeps the colours cleanly
// separable for multi-pen plotting.
import type { Pt2 } from "./render";

const COLOR_HEX: Record<string, string> = {
  black: "#111111", red: "#ff0000", blue: "#0000ff", green: "#008000",
};

function pathD(line: Pt2[]): string {
  if (line.length === 0) return "";
  return "M" + line.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join("L");
}

export function polylinesToSvg(
  polylines: Pt2[][], width: number, height: number, color = "black",
): string {
  const w = Math.max(width, 0.1).toFixed(3);
  const h = Math.max(height, 0.1).toFixed(3);
  const stroke = COLOR_HEX[color] ?? color;
  const paths = polylines
    .filter((l) => l.length >= 2)
    .map((l) => `<path d="${pathD(l)}" fill="none" stroke="${stroke}" stroke-width="0.3"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" ` +
    `viewBox="0 0 ${w} ${h}">${paths}</svg>`
  );
}
