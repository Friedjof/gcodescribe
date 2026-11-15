import { toPath, type Guide, type Pt } from "../../lib/geometry";
import type { Tool } from "../../PaintCanvas";

/** Transient feedback drawn above the objects: live draft preview, erase-line
 * highlight, marquee rectangle, alignment guides. */
export default function OverlayLayer({
  draftTool,
  draftWorld,
  lineErasePreview,
  marqueeRect,
  guides,
  stroke,
  effRadius,
}: {
  draftTool: Tool | null;
  draftWorld: Pt[][];
  lineErasePreview: { id: string; line: Pt[] }[];
  marqueeRect: [number, number, number, number] | null;
  guides: Guide[];
  stroke: number;
  effRadius: number;
}) {
  const STROKE = stroke;
  return (
    <>
      {lineErasePreview.map(({ id, line }) => (
        <path
          key={`erase-preview-${id}`}
          d={toPath(line)}
          fill="none"
          stroke="var(--err)"
          strokeWidth={Math.max(STROKE * 2.8, effRadius * 0.55)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.95}
          pointerEvents="none"
        />
      ))}

      {/* live draft preview */}
      {draftWorld.map((line, i) => (
        <path key={`d${i}`} d={toPath(line as Pt[])}
          fill={draftTool === "areaFill" ? "var(--busy)" : "none"}
          fillOpacity={draftTool === "areaFill" ? 0.14 : undefined}
          stroke={draftTool === "erase" || draftTool === "eraseLine" ? "var(--err)" : "var(--busy)"}
          strokeWidth={draftTool === "erase" || draftTool === "eraseLine" ? effRadius * 2 : STROKE}
          strokeDasharray={draftTool === "eraseLine" ? `${STROKE * 2} ${STROKE}` : undefined}
          strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {marqueeRect && (
        <rect x={marqueeRect[0]} y={marqueeRect[1]}
          width={marqueeRect[2] - marqueeRect[0]} height={marqueeRect[3] - marqueeRect[1]}
          fill="rgba(10,132,255,0.12)" stroke="var(--accent)" strokeWidth={STROKE}
          strokeDasharray={`${STROKE * 2} ${STROKE}`} />
      )}

      {/* alignment guides while dragging */}
      {guides.map((g, i) =>
        g.axis === "x" ? (
          <line key={`g${i}`} x1={g.pos} y1={g.from} x2={g.pos} y2={g.to}
            stroke="var(--accent)" strokeWidth={STROKE} strokeDasharray={`${STROKE * 3} ${STROKE * 2}`}
            pointerEvents="none" />
        ) : (
          <line key={`g${i}`} x1={g.from} y1={g.pos} x2={g.to} y2={g.pos}
            stroke="var(--accent)" strokeWidth={STROKE} strokeDasharray={`${STROKE * 3} ${STROKE * 2}`}
            pointerEvents="none" />
        )
      )}

    </>
  );
}
