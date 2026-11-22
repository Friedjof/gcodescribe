import { memo, useId, useMemo, type CSSProperties } from "react";
import type { Calibration, Page } from "../../../../api";
import { backsideFlip, type TurnEdge } from "../../lib/backside";
import ObjectsLayer from "./ObjectsLayer";

export default memo(function BacksideLayer({ page, cal, edge, opacity, stroke, active = true, interactive = false }: {
  page: Page; cal: Calibration; edge: TurnEdge; opacity: number; stroke: number; active?: boolean; interactive?: boolean;
}) {
  const clip = useId();
  const { paper, transform } = backsideFlip(cal, edge);
  // A plotted front side must remain readable at the chosen reference opacity.
  const objects = useMemo(() => page.objects.map((object, index) => ({ object, index }))
    .sort((a, b) => (a.object.zOrder ?? a.index) - (b.object.zOrder ?? b.index))
    .map(({ object }) => ({ ...object, plotted: false })), [page.objects]);
  return <g data-backside-reference={page.id} pointerEvents="none" aria-hidden="true"
    opacity={opacity} style={{ "--ink": "var(--accent)" } as CSSProperties}>
    <defs><clipPath id={clip}><polygon points={paper.map(point => point.join(",")).join(" ")}/></clipPath></defs>
    <g clipPath={`url(#${clip})`}><g transform={transform}>
      <ObjectsLayer objects={objects} selectedIds={[]} stroke={stroke} active={active} interactive={interactive}/>
    </g></g>
  </g>;
});
