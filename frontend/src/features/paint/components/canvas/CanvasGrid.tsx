import { useId } from "react";
import { useI18n } from "../../../../i18n";

/** Plot-area background with its top edge marked directly on the border. */
export default function CanvasGrid({
  W,
  H,
  S,
  pad,
  step,
  major,
  gridVisible = true,
  showOrientation = true,
  shadow = true,
  pixel = 1,
}: {
  W: number;
  H: number;
  S: number;
  pad: number;
  step: number;
  major: number;
  gridVisible?: boolean;
  showOrientation?: boolean;
  shadow?: boolean;
  pixel?: number;
}) {
  const { t } = useI18n();
  const shadowId = useId();
  const markerSize = Math.min(W / 9, pixel * 10);
  const markerGap = markerSize * 1.8;
  return (
    <>
      <defs>
        <filter id={shadowId} x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy={pixel * 1.5} stdDeviation={pixel * 1.5} floodColor="#1b2638" floodOpacity="0.16"/></filter>
        <pattern id="pc-grid-minor" width={step} height={step} patternUnits="userSpaceOnUse">
          <path d={`M ${step} 0 L 0 0 L 0 ${step}`} fill="none"
            stroke="var(--paper-grid-minor)" strokeWidth={pixel * 0.45} />
        </pattern>
        <pattern id="pc-grid-major" width={major} height={major} patternUnits="userSpaceOnUse">
          <rect width={major} height={major} fill="url(#pc-grid-minor)" />
          <path d={`M ${major} 0 L 0 0 L 0 ${major}`} fill="none"
            stroke="var(--paper-grid-major)" strokeWidth={pixel * 0.7} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="var(--paper)"
        stroke="var(--paper-border)" strokeWidth={pixel * 0.9} filter={shadow ? `url(#${shadowId})` : undefined} />
      {gridVisible && <rect x={0} y={0} width={W} height={H} fill="url(#pc-grid-major)" />}
      {showOrientation && <g className="canvas-orientation-marker" pointerEvents="none" aria-hidden="true">
        <path d={`M 0 0 H ${W / 2 - markerGap} M ${W / 2 + markerGap} 0 H ${W}`} strokeWidth={pixel * 1.5} />
        <rect x={W / 2 - markerGap} y={-markerSize * .65} width={markerGap * 2} height={markerSize * 1.3} fill="var(--paper)" />
        <text x={W / 2} y={0} textAnchor="middle" dominantBaseline="central" style={{ fontSize: markerSize }}>{t("paint.orientationTop")}</text>
      </g>}
      {pad > 0 && <g pointerEvents="none" aria-hidden="true">
        <text x={W / 2} y={H + pad * 0.7} fontSize={S * 0.022}
          fill="var(--muted)" textAnchor="middle">
          {W.toFixed(0)} × {H.toFixed(0)} mm
        </text>
      </g>}
    </>
  );
}
