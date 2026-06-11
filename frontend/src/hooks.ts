import { useEffect, useRef, useState } from "react";

export type ArrowDir = "left" | "right" | "up" | "down" | "raise" | "lower";

export interface ArrowHandlers {
  left?: () => void;
  right?: () => void;
  up?: () => void;
  down?: () => void;
  raise?: () => void; // Z+
  lower?: () => void; // Z-
}

/**
 * Bind arrow-key jogging to the window while `enabled`.
 *
 * ← → ↑ ↓ map to left/right/up/down (X-/X+/Y+/Y-); PageUp/PageDown to
 * raise/lower (Z+/Z-). Ignored while typing in a form field. Returns the
 * direction currently "pressed" (briefly), so the matching button can be
 * highlighted for visual feedback.
 */
export function useArrowKeys(handlers: ArrowHandlers, enabled = true): ArrowDir | null {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [pressed, setPressed] = useState<ArrowDir | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const KEYS: Record<string, ArrowDir> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      PageUp: "raise",
      PageDown: "lower",
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable)
        return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const dir = KEYS[e.key];
      if (!dir) return;
      const fn = ref.current[dir];
      if (!fn) return;
      e.preventDefault();
      fn();
      setPressed(dir);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setPressed(null), 160);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer.current);
    };
  }, [enabled]);

  return pressed;
}
