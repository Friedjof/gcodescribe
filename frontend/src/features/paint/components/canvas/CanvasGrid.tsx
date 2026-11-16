import { useId } from "react";
import { useI18n } from "../../../../i18n";

/** Plot-area background: bordered sheet, minor/major grid pattern, the
 * orientation marker above the sheet and the dimension label below it. */
export default function CanvasGrid({
  W,
  H,
  S,
  pad,
  step,
  major,
  gridVisible = true,
  showOrientation = true,
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
  pixel?: number;
}) {
  const { t } = useI18n();
  const shadowId = useId();
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
        stroke="var(--paper-border)" strokeWidth={pixel * 0.9} filter={`url(#${shadowId})`} />
      {gridVisible && <rect x={0} y={0} width={W} height={H} fill="url(#pc-grid-major)" />}
      {pad > 0 && <g pointerEvents="none" aria-hidden="true">
        {showOrientation && <g className="canvas-orientation-marker">
          <path d={`M ${W / 2 - S * 0.055} ${-pad * 0.45} L ${W / 2} ${-pad * 0.7} L ${W / 2 + S * 0.055} ${-pad * 0.45}`} />
          <text x={W / 2} y={-pad * 0.14} textAnchor="middle">{t("paint.orientationTop")}</text>
        </g>}
        <text x={W / 2} y={H + pad * 0.7} fontSize={S * 0.022}
          fill="var(--muted)" textAnchor="middle">
          {W.toFixed(0)} × {H.toFixed(0)} mm
        </text>
      </g>}
    </>
  );
}
