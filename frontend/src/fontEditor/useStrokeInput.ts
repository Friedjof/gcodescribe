import { useCallback, useRef, useState } from "react";
import type { StrokePoint } from "../api";
import type { Pt } from "./strokeGeometry";

// Captures one in-progress stroke from pointer events as raw em-space points
// (with timing/pressure/pointer type). On pointer-up it hands the raw points to
// `onComplete`. Coordinate conversion is injected so this hook stays free of
// DOM/viewBox details.
//
// The authoritative point buffer lives in a ref; `active` state only mirrors it
// for rendering. `onComplete` is fired OUTSIDE any state updater — calling a side
// effect inside a setState updater double-fires under React.StrictMode and was
// adding every stroke twice.

// Drop points closer than this (em units) to the previous one to avoid spamming
// near-duplicate samples while the pointer is held still.
const MIN_STEP = 1.5;

export interface StrokeInput {
  active: StrokePoint[] | null;
  begin: (clientX: number, clientY: number, e: PointerEvent | React.PointerEvent) => void;
  extend: (clientX: number, clientY: number, e: PointerEvent | React.PointerEvent) => void;
  finish: () => void;
  cancel: () => void;
}

export function useStrokeInput(
  toEm: (clientX: number, clientY: number) => Pt,
  onComplete: (raw: StrokePoint[]) => void
): StrokeInput {
  const [active, setActive] = useState<StrokePoint[] | null>(null);
  const activeRef = useRef<StrokePoint[] | null>(null);
  const drawing = useRef(false);
  const startTime = useRef(0);

  const set = useCallback((pts: StrokePoint[] | null) => {
    activeRef.current = pts;
    setActive(pts);
  }, []);

  const sample = useCallback(
    (clientX: number, clientY: number, e: PointerEvent | React.PointerEvent): StrokePoint => {
      const em = toEm(clientX, clientY);
      const point: StrokePoint = {
        x: em.x,
        y: em.y,
        t: Math.max(0, Math.round(performance.now() - startTime.current)),
      };
      if (typeof e.pressure === "number" && e.pressure > 0) point.pressure = e.pressure;
      if (e.pointerType) point.pointerType = e.pointerType;
      return point;
    },
    [toEm]
  );

  const begin = useCallback(
    (clientX: number, clientY: number, e: PointerEvent | React.PointerEvent) => {
      drawing.current = true;
      startTime.current = performance.now();
      set([sample(clientX, clientY, e)]);
    },
    [sample, set]
  );

  const extend = useCallback(
    (clientX: number, clientY: number, e: PointerEvent | React.PointerEvent) => {
      if (!drawing.current) return;
      const cur = activeRef.current;
      if (!cur) return;
      const next = sample(clientX, clientY, e);
      const last = cur[cur.length - 1];
      if (Math.hypot(next.x - last.x, next.y - last.y) < MIN_STEP) return;
      set([...cur, next]);
    },
    [sample, set]
  );

  const finish = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    const pts = activeRef.current;
    set(null);
    if (pts && pts.length > 0) onComplete(pts);
  }, [onComplete, set]);

  const cancel = useCallback(() => {
    drawing.current = false;
    set(null);
  }, [set]);

  return { active, begin, extend, finish, cancel };
}
