import { useI18n } from "../../../../i18n";
import TransformHandle from "./TransformHandle";
import type { SceneObject } from "../../../../api";
import { localBounds as geometryBounds, IDENTITY, type Pt } from "../../lib/geometry";
import { objectPlacementFrame } from "../../lib/sourcePage";
import {
  normalizeDeg,
  resizeLocals,
  screenVectorToRotatedLocal,
  worldPoint,
  type ResizeEdge,
  type ViewRotation,
} from "../../lib/viewTransform";

const RESIZE_EDGES: ResizeEdge[] = ["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"];

// Bidirectional resize cursors by screen angle, 45° sectors starting east (y down).
const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];

/** Cursor for a handle whose screen direction from the selection center is `deg`. */
function resizeCursor(deg: number): string {
  return RESIZE_CURSORS[Math.round(normalizeDeg(deg) / 45) % 4];
}

/** Hit areas, selection outlines and the move/resize/rotate handles for
 * single objects plus the outline/scale/rotate handles of a multi-selection.
 * All gesture state lives in PaintCanvas — this layer only starts gestures. */
export default function SelectionLayer({
  objects,
  selectedIds,
  selectedObjects,
  selectedBounds,
  stroke,
  handleSize,
  objectSelectionIds,
  onSelect,
  onContextMenuSelection,
  onStartMove,
  onStartResize,
  onStartRotate,
  onStartGroupRotate,
  onStartGroupScale,
  viewRotation,
}: {
  objects: SceneObject[];
  selectedIds: string[];
  selectedObjects: SceneObject[];
  selectedBounds: [number, number, number, number] | null;
  stroke: number;
  handleSize: number;
  objectSelectionIds: (obj: SceneObject) => string[];
  onSelect: (ids: string[]) => void;
  onContextMenuSelection: (ids: string[], x: number, y: number) => void;
  onStartMove: (e: React.PointerEvent, obj: SceneObject) => void;
  onStartResize: (e: React.PointerEvent, obj: SceneObject, edge: ResizeEdge) => void;
  onStartRotate: (e: React.PointerEvent, obj: SceneObject, center: Pt) => void;
  onStartGroupRotate: (e: React.PointerEvent, ids: string[], center: Pt) => void;
  onStartGroupScale: (e: React.PointerEvent, ids: string[], center: Pt) => void;
  viewRotation: ViewRotation;
}) {
  const { t: translate } = useI18n();
  const STROKE = stroke;
  const HANDLE = handleSize;
  return (
    <>
      {[...objects].sort((a, b) => Number(selectedIds.includes(a.id)) - Number(selectedIds.includes(b.id))).map((obj) => {
        const t = obj.transform ?? IDENTITY;
        const localLines = objectPlacementFrame(obj);
        const localBounds = geometryBounds(localLines);
        const [lx0, ly0, lx1, ly1] = localBounds;
        const boxCorners = [
          worldPoint([lx0, ly0], t),
          worldPoint([lx1, ly0], t),
          worldPoint([lx1, ly1], t),
          worldPoint([lx0, ly1], t),
        ];
        const bx0 = Math.min(...boxCorners.map((p) => p[0]));
        const by0 = Math.min(...boxCorners.map((p) => p[1]));
        const bx1 = Math.max(...boxCorners.map((p) => p[0]));
        const by1 = Math.max(...boxCorners.map((p) => p[1]));
        const m = STROKE * 2;
        const sel = selectedIds.includes(obj.id);
        const singleSel = selectedIds.length === 1 && sel;
        const cx = t.x;
        const cy = t.y;
        const bw = bx1 - bx0;
        const bh = by1 - by0;
        const topMid: Pt = [(boxCorners[0][0] + boxCorners[1][0]) / 2, (boxCorners[0][1] + boxCorners[1][1]) / 2];
        const rotateOffset = screenVectorToRotatedLocal([0, -HANDLE * 3.2], -t.rotation);
        const rotateHandle: Pt = [topMid[0] + rotateOffset[0], topMid[1] + rotateOffset[1]];
        const outline = boxCorners.map((p) => p.join(",")).join(" ");
        return (
          <g key={`s${obj.id}`}>
            {/* hit + selection outline */}
            <rect
              x={bx0 - m} y={by0 - m} width={bw + 2 * m} height={bh + 2 * m}
              fill="transparent"
              style={{ cursor: "move" }}
              onPointerDown={(e) => {
                if (e.button === 2) {
                  e.stopPropagation();
                  const targetIds = objectSelectionIds(obj);
                  const ids = selectedIds.includes(obj.id) ? selectedIds : targetIds;
                  if (!selectedIds.includes(obj.id)) onSelect(ids);
                  onContextMenuSelection(ids, e.clientX, e.clientY);
                  return;
                }
                onStartMove(e, obj);
              }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
            />
            <polygon
              points={outline}
              fill="none"
              stroke={sel ? "var(--accent)" : "transparent"}
              strokeWidth={STROKE}
              strokeDasharray={`${STROKE * 2} ${STROKE}`}
              pointerEvents="none"
            />
            {singleSel && (
              <>
                {/* rotate tether + handle */}
                <line x1={topMid[0]} y1={topMid[1]} x2={rotateHandle[0]} y2={rotateHandle[1]}
                  stroke="var(--accent)" strokeWidth={STROKE} strokeDasharray={`${STROKE} ${STROKE}`}
                  pointerEvents="none" />
                <TransformHandle x={rotateHandle[0]} y={rotateHandle[1]} size={HANDLE}
                  cursor="grab" round label={translate("paint.canvas.rotateHandle")}
                  onPointerDown={(e) => onStartRotate(e, obj, [cx, cy])} />
                {/* 8 resize handles — cursor follows the handle's on-screen direction,
                    so it stays correct for rotated/flipped objects and view rotation */}
                {RESIZE_EDGES.map((edge) => {
                  const { handle } = resizeLocals(edge, localBounds);
                  const [hx, hy] = worldPoint(handle, t);
                  const [wcx, wcy] = worldPoint([(lx0 + lx1) / 2, (ly0 + ly1) / 2], t);
                  const deg = (Math.atan2(hy - wcy, hx - wcx) * 180) / Math.PI + viewRotation;
                  // Hide crowded middle grips on small objects; leave corners usable.
                  const width = Math.abs((lx1 - lx0) * (t.scaleX ?? t.scale));
                  const height = Math.abs((ly1 - ly0) * (t.scaleY ?? t.scale));
                  if ((edge === "tc" || edge === "bc") && width < HANDLE * 5) return null;
                  if ((edge === "ml" || edge === "mr") && height < HANDLE * 5) return null;
                  if (Math.min(width, height) < HANDLE * 2.4 && edge !== "br") return null;
                  return <TransformHandle key={edge} x={hx} y={hy} size={HANDLE}
                    cursor={resizeCursor(deg)} label={translate("paint.canvas.resizeHandle")}
                    onPointerDown={(e) => onStartResize(e, obj, edge)} />;
                })}
              </>
            )}
          </g>
        );
      })}

      {/* group selection outline + rotate + scale handles */}
      {selectedBounds && (() => {
        const [bx0, by0, bx1, by1] = selectedBounds;
        const m = STROKE * 3;
        const cx = (bx0 + bx1) / 2;
        const cy = (by0 + by1) / 2;
        const rotHandleX = cx;
        const rotHandleY = by0 - m - HANDLE * 3.2;
        return (
          <g>
            <rect
              x={bx0 - m} y={by0 - m} width={bx1 - bx0 + 2 * m} height={by1 - by0 + 2 * m}
              fill="none" stroke="var(--accent)" strokeWidth={STROKE * 1.2}
              strokeDasharray={`${STROKE * 3} ${STROKE * 1.5}`}
              pointerEvents="none"
            />
            <line
              x1={cx} y1={by0 - m} x2={rotHandleX} y2={rotHandleY}
              stroke="var(--accent)" strokeWidth={STROKE}
              strokeDasharray={`${STROKE} ${STROKE}`}
              pointerEvents="none"
            />
            <TransformHandle x={rotHandleX} y={rotHandleY} size={HANDLE} round cursor="grab"
              label={translate("paint.canvas.rotateGroup")}
              onPointerDown={(e) => onStartGroupRotate(e, selectedObjects.map((obj) => obj.id), [cx, cy])} />
            <TransformHandle x={bx1 + m} y={by1 + m} size={HANDLE}
              cursor={resizeCursor(45 + viewRotation)} label={translate("paint.canvas.resizeGroup")}
              onPointerDown={(e) => onStartGroupScale(e, selectedObjects.map((obj) => obj.id), [cx, cy])} />
          </g>
        );
      })()}
    </>
  );
}
