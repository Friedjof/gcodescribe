import { useEffect, useRef, useState } from "react";

/** A keyboard-accessible separator. Width previews are reversible until release. */
export default function PanelResizeHandle({ label, width, min, max, direction = 1, onChange, onCommit }: {
  label: string; width: number; min: number; max: number; direction?: 1 | -1;
  onChange: (width: number) => void; onCommit: (width: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; width: number; next: number } | null>(null);
  const callbacks = useRef({ onChange, onCommit }); callbacks.current = { onChange, onCommit };
  const clamp = (value: number) => Math.round(Math.max(min, Math.min(max, value)));
  const cancel = () => {
    if (drag.current) callbacks.current.onChange(drag.current.width);
    drag.current = null; setDragging(false);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && drag.current) { event.preventDefault(); cancel(); } };
    window.addEventListener("keydown", escape); window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("keydown", escape); window.removeEventListener("blur", cancel); };
  }, []);
  return <div className={`panel-resize-handle${dragging ? " dragging" : ""}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
    onKeyDown={event => {
      const delta = event.shiftKey ? 40 : 10;
      const next = event.key === "Home" ? min : event.key === "End" ? max
        : event.key === "ArrowLeft" ? width - delta * direction : event.key === "ArrowRight" ? width + delta * direction : null;
      if (next === null) return;
      event.preventDefault(); const value = clamp(next); onChange(value); onCommit(value);
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { id: event.pointerId, x: event.clientX, width, next: width };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      current.next = clamp(current.width + (event.clientX - current.x) * direction);
      onChange(current.next);
    }}
    onPointerUp={event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      drag.current = null; setDragging(false); onCommit(current.next);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={cancel} onLostPointerCapture={cancel} />;
}
