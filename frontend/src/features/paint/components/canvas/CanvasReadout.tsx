import type { Pt } from "../../lib/geometry";

/** Screen-aligned feedback that stays legible and inside the visible viewport. */
export default function CanvasReadout({ at, lines, pixel, view, emphasized }: {
  at: Pt; lines: string[]; pixel: number; view: { x: number; y: number; w: number; h: number }; emphasized: boolean;
}) {
  const maxChars = Math.max(14, Math.floor((view.w / pixel - 34) / 7.2));
  const wrapped = lines.flatMap(line => {
    const rows = [""];
    for (const word of line.split(" ")) {
      const last = rows.length - 1;
      if (rows[last] && rows[last].length + word.length + 1 > maxChars) rows.push(word);
      else rows[last] += (rows[last] ? " " : "") + word;
    }
    return rows;
  });
  const width = (Math.max(...wrapped.map(line => line.length), 1) * 7.2 + 22) * pixel;
  const height = (wrapped.length * 19 + 14) * pixel;
  const x = Math.max(view.x + 6 * pixel, Math.min(at[0] + 22 * pixel, view.x + view.w - width - 6 * pixel));
  const y = Math.max(view.y + 6 * pixel, Math.min(at[1] + 24 * pixel, view.y + view.h - height - 6 * pixel));
  return <g className="canvas-readout" pointerEvents="none" aria-hidden="true">
    <rect x={x} y={y} width={width} height={height} rx={6 * pixel}
      fill="var(--panel)" stroke={emphasized ? "var(--ok)" : "var(--accent)"} strokeWidth={pixel} />
    {wrapped.map((line, index) => <text key={index} x={x + 11 * pixel} y={y + (20 + index * 19) * pixel}
      fontSize={(index === 0 ? 13 : 11) * pixel} fill={index === 0 ? "var(--text)" : "var(--muted)"}
      fontFamily="system-ui, sans-serif" fontWeight={index === 0 ? 650 : 400}>{line}</text>)}
  </g>;
}
