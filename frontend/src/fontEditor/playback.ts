import type { Stroke, StrokePoint } from "../api";

// Pure playback timeline for stroke order/speed preview. Each point gets an
// absolute time; strokes follow one another with a pen-up gap. `revealCounts`
// turns an elapsed time into how many points of each stroke are visible.

export const PEN_GAP_MS = 160; // pause between strokes
const MIN_STEP_MS = 8; // floor so playback advances even with equal timestamps

export interface TimelineItem {
  stroke: number;
  idx: number;
  time: number;
}

export interface Timeline {
  seq: TimelineItem[];
  total: number;
}

export function strokePoints(stroke: Stroke): StrokePoint[] {
  return stroke.points.length ? stroke.points : stroke.rawPoints;
}

export function buildTimeline(strokes: Stroke[]): Timeline {
  const seq: TimelineItem[] = [];
  let base = 0;
  for (let si = 0; si < strokes.length; si += 1) {
    const pts = strokePoints(strokes[si]);
    if (pts.length === 0) continue;
    const t0 = pts[0].t ?? 0;
    let dur = 0;
    pts.forEach((p, pi) => {
      // Relative time within the stroke, with a per-index floor so progress is
      // monotonic even when timestamps are missing or identical.
      const rel = Math.max((p.t ?? pi * 12) - t0, pi * MIN_STEP_MS);
      dur = rel;
      seq.push({ stroke: si, idx: pi, time: base + rel });
    });
    base += dur + PEN_GAP_MS;
  }
  return { seq, total: seq.length ? seq[seq.length - 1].time : 0 };
}

/** Visible point count per stroke at `elapsed` ms (length === strokeCount). */
export function revealCounts(
  timeline: Timeline,
  elapsed: number,
  strokeCount: number
): number[] {
  const counts = new Array<number>(strokeCount).fill(0);
  for (const item of timeline.seq) {
    if (item.time <= elapsed && item.idx + 1 > counts[item.stroke]) {
      counts[item.stroke] = item.idx + 1;
    }
  }
  return counts;
}
