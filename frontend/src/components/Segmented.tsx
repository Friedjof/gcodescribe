import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface SegOption<T> {
  value: T;
  label: ReactNode;
  title?: string;
}

/**
 * iOS-style segmented control that fills its row and animates the active
 * highlight: a single indicator element slides/resizes to the active button
 * instead of the background snapping between buttons.
 *
 * The `wrap` variant (e.g. a many-item page picker) keeps natural button
 * sizes and a static highlight, since a sliding indicator across multiple
 * rows is not meaningful.
 */
export default function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  suffix,
  wrap = false,
  className = "",
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  suffix?: ReactNode;
  wrap?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    ready: boolean;
  }>({ left: 0, top: 0, width: 0, height: 0, ready: false });

  useLayoutEffect(() => {
    if (wrap) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLButtonElement>('[data-active="true"]');
      if (!active) return;
      setInd({
        // clientLeft/Top strip the container border so the indicator (anchored
        // to the padding box) lines up exactly with the button.
        left: active.offsetLeft - el.clientLeft,
        top: active.offsetTop - el.clientTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
        ready: true,
      });
    };
    measure();
    // Buttons are flex:1, so their width changes with the container — keep the
    // indicator aligned on resize.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, options.length, wrap]);

  return (
    <div className={`seg ${wrap ? "wrap" : ""} ${className}`} ref={ref}>
      {!wrap && ind.ready && (
        <span
          className="seg-indicator"
          style={{
            transform: `translate(${ind.left}px, ${ind.top}px)`,
            width: ind.width,
            height: ind.height,
          }}
        />
      )}
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          data-active={value === o.value}
          className={value === o.value ? "active" : ""}
          title={o.title}
          aria-label={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
      {suffix}
    </div>
  );
}
