import { useCallback, useState } from "react";
import type { Stroke } from "../api";

// Holds the strokes of the glyph currently being edited, with stroke-level
// undo/redo. `load` swaps in a glyph's strokes without polluting history (it's
// not an undoable edit); `markSaved` clears the dirty flag after persisting.

interface State {
  strokes: Stroke[];
  past: Stroke[][];
  future: Stroke[][];
  dirty: boolean;
}

const EMPTY: State = { strokes: [], past: [], future: [], dirty: false };

export function useGlyphEditing() {
  const [state, setState] = useState<State>(EMPTY);

  // `next` may be a value or an updater of the current strokes; either way the
  // previous strokes are pushed onto the undo stack.
  const commit = useCallback((next: Stroke[] | ((cur: Stroke[]) => Stroke[])) => {
    setState((s) => ({
      strokes: typeof next === "function" ? next(s.strokes) : next,
      past: [...s.past, s.strokes],
      future: [],
      dirty: true,
    }));
  }, []);

  const addStroke = useCallback(
    (stroke: Stroke) => commit((cur) => [...cur, stroke]),
    [commit]
  );

  const reset = useCallback(() => commit([]), [commit]);

  // Replace all strokes as one undoable edit (e.g. re-stabilizing the buffer).
  const replace = useCallback((strokes: Stroke[]) => commit(strokes), [commit]);

  const undo = useCallback(() => {
    setState((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return {
        strokes: prev,
        past: s.past.slice(0, -1),
        future: [s.strokes, ...s.future],
        dirty: true,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return {
        strokes: next,
        past: [...s.past, s.strokes],
        future: s.future.slice(1),
        dirty: true,
      };
    });
  }, []);

  const load = useCallback((strokes: Stroke[]) => {
    setState({ strokes, past: [], future: [], dirty: false });
  }, []);

  const markSaved = useCallback(() => {
    setState((s) => ({ ...s, dirty: false }));
  }, []);

  return {
    strokes: state.strokes,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    dirty: state.dirty,
    addStroke,
    reset,
    replace,
    undo,
    redo,
    load,
    markSaved,
  };
}
