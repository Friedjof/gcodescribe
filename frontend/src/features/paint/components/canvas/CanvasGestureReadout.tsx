import type { SceneObject } from "../../../../api";
import { useI18n } from "../../../../i18n";
import { IDENTITY, localBounds, objectWorldBounds, type Bounds, type Pt } from "../../lib/geometry";
import { objectPlacementFrame } from "../../lib/sourcePage";
import { rotatePoint, type ViewRotation } from "../../lib/viewTransform";
import type { Tool } from "../../PaintCanvas";
import CanvasReadout from "./CanvasReadout";

export interface RotationHint {
  at: Pt; currentDeg: number; deltaDeg: number; snapped: boolean;
}

export interface GestureFeedback {
  at: Pt; mode: "move" | "resize" | "groupScale";
  snap: "grid" | "guides" | "free"; constrained: boolean; linked?: boolean;
}

export default function CanvasGestureReadout({ objects, feedback, rotationHint, draft,
  pixel, view, width: W, height: H, viewRotation }: {
  objects: SceneObject[]; feedback: GestureFeedback | null; rotationHint: RotationHint | null;
  draft: { tool: Tool; points: Pt[] } | null;
  pixel: number; view: { x: number; y: number; w: number; h: number };
  width: number; height: number; viewRotation: ViewRotation;
}) {
  const { t, lang } = useI18n();
  if (!feedback && !rotationHint && !draft) return null;
  const formatter = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const readoutObjects = objects;
  const readoutBounds = feedback ? readoutObjects.reduce<Bounds | null>((bounds, obj) => {
    const next = objectWorldBounds(objectPlacementFrame(obj), obj.transform ?? IDENTITY);
    return bounds ? [Math.min(bounds[0], next[0]), Math.min(bounds[1], next[1]), Math.max(bounds[2], next[2]), Math.max(bounds[3], next[3])] : next;
  }, null) : null;
  let readoutLines: string[] = [];
  let readoutAt: Pt | null = null;
  if (rotationHint) {
    readoutAt = rotationHint.at;
    readoutLines = [`${formatter.format(rotationHint.currentDeg)}° (${rotationHint.deltaDeg >= 0 ? "+" : ""}${formatter.format(rotationHint.deltaDeg)}°)`,
      t(rotationHint.snapped ? "paint.canvas.angleSnapped" : "paint.canvas.rotationHelp")];
  } else if (feedback && readoutBounds) {
    readoutAt = feedback.at;
    let width = readoutBounds[2] - readoutBounds[0], height = readoutBounds[3] - readoutBounds[1];
    if (readoutObjects.length === 1 && feedback.mode === "resize") {
      const object = readoutObjects[0], transform = object.transform ?? IDENTITY;
      const [x0, y0, x1, y1] = localBounds(objectPlacementFrame(object));
      width = (x1 - x0) * Math.abs(transform.scaleX ?? transform.scale);
      height = (y1 - y0) * Math.abs(transform.scaleY ?? transform.scale);
    }
    readoutLines = [feedback.mode === "move"
      ? `X ${formatter.format(readoutBounds[0])} · Y ${formatter.format(readoutBounds[1])} mm`
      : `${formatter.format(width)} × ${formatter.format(height)} mm`,
      t(feedback.constrained ? "paint.canvas.plotLimit" : feedback.linked ? "paint.canvas.proportional" :
        feedback.snap === "guides" ? "paint.canvas.aligned" : feedback.snap === "grid" ? "paint.canvas.gridSnapped" : "paint.canvas.freeHelp")];
  }


  if (!readoutAt && draft && ["line", "rect", "circle", "semicircle", "maskRect", "maskCircle"].includes(draft.tool)) {
    const [start, end] = draft.points;
    if (start && end) {
      readoutAt = end;
      const width = Math.abs(end[0] - start[0]), height = Math.abs(end[1] - start[1]);
      readoutLines = [draft.tool === "line" ? `${formatter.format(Math.hypot(width, height))} mm` :
        `${formatter.format(width)} × ${formatter.format(height)} mm`];
    }
  }
  if (!readoutAt) return null;
  return <CanvasReadout at={rotatePoint(readoutAt, W, H, viewRotation)} lines={readoutLines}
    pixel={pixel} view={view} emphasized={!!feedback?.constrained || !!rotationHint?.snapped} />;
}
