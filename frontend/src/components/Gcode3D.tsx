import { useEffect, useRef, useState } from "react";
import type { GcodePreview3D } from "../api";
import { useI18n } from "../i18n";

type V3 = [number, number, number];

/**
 * Lightweight interactive 3D viewer for a G-code tool path (Canvas 2D, no
 * external 3D dependency). Drag to orbit, scroll to zoom, right-drag to pan.
 */
export default function Gcode3D({
  data,
  chrome = true,
  showTravels: travelsProp,
  resetToken = 0,
}: {
  data: GcodePreview3D;
  chrome?: boolean;
  // Controlled mode for hosts that render their own controls (e.g. in a
  // modal footer): pass showTravels and bump resetToken to reset the view.
  showTravels?: boolean;
  resetToken?: number;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ yaw: -0.7, pitch: 1.0, zoom: 1, panX: 0, panY: 0 });
  const drag = useRef<{ x: number; y: number; mode: "orbit" | "pan" } | null>(null);
  const renderRef = useRef<() => void>(() => {});
  const [travelsState, setShowTravels] = useState(true);
  const showTravels = travelsProp ?? travelsState;
  const showTravelsRef = useRef(showTravels);
  showTravelsRef.current = showTravels;

  useEffect(() => {
    renderRef.current();
  }, [showTravels]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const b = data.bounds ?? [0, 0, 0, 200, 200, 10];
    const center: V3 = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const extent = Math.max(b[3] - b[0], b[4] - b[1], 1);

    const project = (p: number[], w: number, h: number, baseScale: number): [number, number] => {
      const { yaw, pitch, zoom, panX, panY } = view.current;
      const dx = p[0] - center[0];
      const dy = p[1] - center[1];
      const dz = p[2] - center[2];
      // yaw about Z, then pitch about X
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const x1 = dx * cy - dy * sy;
      const y1 = dx * sy + dy * cy;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const y2 = y1 * cp - dz * sp;
      const z2 = y1 * sp + dz * cp;
      const s = baseScale * zoom;
      return [w / 2 + panX + x1 * s, h / 2 + panY - z2 * s + y2 * 0]; // ortho
    };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const baseScale = (Math.min(w, h) * 0.78) / extent;

      // Ground plate (drawing bounds at the paper plane) + grid for context.
      const z0 = b[2];
      const corners: V3[] = [
        [b[0], b[1], z0], [b[3], b[1], z0], [b[3], b[4], z0], [b[0], b[4], z0],
      ];
      const cp = corners.map((c) => project(c, w, h, baseScale));
      ctx.beginPath();
      ctx.moveTo(cp[0][0], cp[0][1]);
      for (let i = 1; i < cp.length; i++) ctx.lineTo(cp[i][0], cp[i][1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const GRID = 8;
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let i = 1; i < GRID; i++) {
        const tx = b[0] + ((b[3] - b[0]) * i) / GRID;
        const a = project([tx, b[1], z0], w, h, baseScale);
        const c = project([tx, b[4], z0], w, h, baseScale);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]);
        const ty = b[1] + ((b[4] - b[1]) * i) / GRID;
        const d = project([b[0], ty, z0], w, h, baseScale);
        const e = project([b[3], ty, z0], w, h, baseScale);
        ctx.moveTo(d[0], d[1]); ctx.lineTo(e[0], e[1]);
      }
      ctx.stroke();

      const stroke = (lines: number[][][], style: string, width: number, dash?: number[]) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
        ctx.beginPath();
        for (const line of lines) {
          const p0 = project(line[0], w, h, baseScale);
          ctx.moveTo(p0[0], p0[1]);
          for (let i = 1; i < line.length; i++) {
            const p = project(line[i], w, h, baseScale);
            ctx.lineTo(p[0], p[1]);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };

      if (showTravelsRef.current)
        stroke(data.travels, "rgba(152,152,158,0.5)", 0.8, [3, 3]);
      stroke(data.draws, "#0a84ff", 1.6);
    };

    const render = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    renderRef.current = render;

    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    render();

    // -- interaction --
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        mode: e.button === 2 || e.shiftKey ? "pan" : "orbit",
      };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
      if (drag.current.mode === "orbit") {
        view.current.yaw += dx * 0.01;
        view.current.pitch = Math.max(0.05, Math.min(Math.PI / 2, view.current.pitch + dy * 0.01));
      } else {
        view.current.panX += dx;
        view.current.panY += dy;
      }
      render();
    };
    const onUp = (e: PointerEvent) => {
      drag.current = null;
      canvas.releasePointerCapture?.(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      view.current.zoom = Math.max(0.2, Math.min(8, view.current.zoom * f));
      render();
    };
    const onContext = (e: Event) => e.preventDefault();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
    };
  }, [data]);

  const resetView = () => {
    view.current = { yaw: -0.7, pitch: 1.0, zoom: 1, panX: 0, panY: 0 };
    renderRef.current();
  };

  useEffect(() => {
    if (resetToken) resetView();
  }, [resetToken]);

  return (
    <div className="g3d">
      <canvas ref={canvasRef} className="g3d-canvas" />
      {chrome && (
        <div className="g3d-bar">
          <span className="muted">{t("g3d.controls")}</span>
          <label className="g3d-toggle">
            <input
              type="checkbox"
              checked={showTravels}
              onChange={(e) => {
                setShowTravels(e.target.checked);
                requestAnimationFrame(() => renderRef.current());
              }}
            />
            {t("g3d.travels")}
          </label>
          <button className="ghost" onClick={resetView}>{t("g3d.resetView")}</button>
        </div>
      )}
    </div>
  );
}
