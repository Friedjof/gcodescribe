/** Visible grip and a larger independent target, both sized in screen pixels. */
export default function TransformHandle({ x, y, size, cursor, label, round = false, onPointerDown }: {
  x: number; y: number; size: number; cursor: string; label: string; round?: boolean;
  onPointerDown: React.PointerEventHandler<SVGGElement>;
}) {
  const target = size * 2.4;
  return <g className="canvas-transform-handle" style={{ cursor }} aria-label={label}
    onPointerDown={onPointerDown}>
    <title>{label}</title>
    <rect x={x - target / 2} y={y - target / 2} width={target} height={target}
      fill="transparent" pointerEvents="all" />
    {round ? <>
      <circle className="handle-face" cx={x} cy={y} r={size * 0.55} fill="var(--panel)"
        stroke="var(--accent)" strokeWidth={size * 0.13} pointerEvents="none" />
      <path d={`M${x - size * .25} ${y}a${size * .25} ${size * .25} 0 1 1 ${size * .25} ${size * .25}`}
        fill="none" stroke="var(--accent)" strokeWidth={size * .12} pointerEvents="none" />
    </> : <rect className="handle-face" x={x - size / 2} y={y - size / 2} width={size} height={size}
      rx={size * .2} fill="var(--panel)" stroke="var(--accent)" strokeWidth={size * .13} pointerEvents="none" />}
  </g>;
}
