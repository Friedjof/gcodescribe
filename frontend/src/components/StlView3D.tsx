import { spherePoint, trackballRotate } from "../features/stl/lib/trackball";
export type StlControlMode = "orbit" | "trackball" | "cad";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import {
  drawMesh3d,
  meshCenter,
  meshDiagonal,
  type Camera,
  type EdgeModel,
  type Mesh,
  type UpAxis,
} from "../features/stl/lib";

/**
 * Interactive shaded 3D view of an STL with the control model of the G-code 3D
 * viewer: drag to orbit, scroll to zoom, shift/right-drag to pan. ALL view state
 * lives in one ref (single source of truth) so dragging is never fought by a
 * prop round-trip. The parent steers orientation only via tokens; orbiting is
 * reported back (onOrient) so the 2D technical preview follows.
 */
export default function StlView3D({
  mesh,
  model,
  azimuth,
  elevation,
  roll = 0,
  controlMode = "orbit",
  fov,
  up,
  distanceFactor,
  featureAngleDeg,
  showTriangles,
  shading,
  opacity,
  showBox,
  orientToken = 0,
  resetToken = 0,
  onOrient,
  autoRotate = false,
}: {
  mesh: Mesh;
  model: EdgeModel;
  azimuth: number;
  elevation: number;
  roll?: number;
  controlMode?: StlControlMode;
  fov: number;
  up: UpAxis;
  distanceFactor: number;
  featureAngleDeg: number;
  showTriangles: boolean;
  shading: boolean;
  opacity: number;
  showBox: boolean;
  orientToken?: number;
  resetToken?: number;
  onOrient?: (azimuth: number, elevation: number, roll: number) => void;
  /** Slowly auto-spin and ignore all pointer/wheel input (gallery preview). */
  autoRotate?: boolean;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ yaw: azimuth, pitch: elevation, roll, zoom: 1, panX: 0, panY: 0 });
  const modeRef=useRef(controlMode);modeRef.current=controlMode;
  const onOrientRef=useRef(onOrient);onOrientRef.current=onOrient;
  const drag = useRef<{ x: number; y: number; mode: "orbit" | "pan" } | null>(null);
  const renderRef = useRef<() => void>(() => {});
  const propsRef = useRef({ mesh, model, fov, up, distanceFactor, featureAngleDeg, showTriangles, shading, opacity, showBox });
  propsRef.current = { mesh, model, fov, up, distanceFactor, featureAngleDeg, showTriangles, shading, opacity, showBox };

  // External orientation set (presets, axis flips, new file).
  useEffect(() => {
    view.current.yaw = azimuth;
    view.current.pitch = elevation;
    view.current.roll = roll;
    renderRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientToken]);

  // External zoom/pan reset.
  useEffect(() => {
    view.current.zoom = 1;
    view.current.panX = 0;
    view.current.panY = 0;
    renderRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  // Visual-only changes just redraw.
  useEffect(() => {
    renderRef.current();
  }, [up, fov, distanceFactor, featureAngleDeg, showTriangles, shading, opacity, showBox]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const p = propsRef.current;
      const camera: Camera = {
        target: meshCenter(p.mesh),
        azimuth: view.current.yaw,
        elevation: view.current.pitch,
        roll: view.current.roll,
        distance: meshDiagonal(p.mesh) * p.distanceFactor,
        perspective: false, // ortho inspect → rotates in place like the G-code view
        fov: p.fov,
        up: p.up,
      };
      drawMesh3d(ctx, w, h, p.mesh, p.model, camera, {
        featureAngleDeg: p.featureAngleDeg,
        showTriangles: p.showTriangles,
        shading: p.shading,
        opacity: p.opacity,
        showBox: p.showBox,
        zoom: view.current.zoom,
        panX: view.current.panX,
        panY: view.current.panY,
      });
    };

    const render = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    renderRef.current = render;
    const ro = new ResizeObserver(render);
    ro.observe(container);
    render();

    // Gallery preview: slow auto-spin, no interaction.
    if (autoRotate) {
      let spin = 0;
      const loop = () => { view.current.yaw += 0.004; draw(); spin = requestAnimationFrame(loop); };
      spin = requestAnimationFrame(loop);
      return () => { cancelAnimationFrame(spin); cancelAnimationFrame(raf); ro.disconnect(); };
    }

    const onDown = (e: PointerEvent) => {
      if(modeRef.current==="cad" && e.button!==1 && e.button!==2)return;
      e.preventDefault();
      container.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, mode: e.button === 2 || e.shiftKey ? "pan" : "orbit" };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      if (drag.current.mode === "orbit") {
        if(modeRef.current==="trackball") {
          const rect=container.getBoundingClientRect(),p=propsRef.current;
          const next=trackballRotate({target:meshCenter(p.mesh),azimuth:view.current.yaw,elevation:view.current.pitch,roll:view.current.roll,
            distance:meshDiagonal(p.mesh)*p.distanceFactor,perspective:false,fov:p.fov,up:p.up},
            spherePoint(drag.current.x-rect.left,drag.current.y-rect.top,rect.width,rect.height),
            spherePoint(e.clientX-rect.left,e.clientY-rect.top,rect.width,rect.height));
          view.current.yaw=next.azimuth;view.current.pitch=next.elevation;view.current.roll=next.roll;
        } else {
          view.current.yaw += dx * 0.01;
          view.current.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, view.current.pitch + dy * 0.01));
        }
      } else {
        view.current.panX += dx;
        view.current.panY += dy;
      }
      drag.current.x=e.clientX;drag.current.y=e.clientY;
      render();
    };
    const onUp = (e: PointerEvent) => {
      if(drag.current?.mode==="orbit")onOrientRef.current?.(view.current.yaw,view.current.pitch,view.current.roll);
      drag.current = null;
      if(container.hasPointerCapture?.(e.pointerId))container.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.zoom = Math.max(0.2, Math.min(8, view.current.zoom * Math.exp(-e.deltaY * 0.0015)));
      render();
    };
    const onContext = (e: Event) => e.preventDefault();

    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
    container.addEventListener("lostpointercapture", onUp);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("contextmenu", onContext);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      container.removeEventListener("lostpointercapture", onUp);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("contextmenu", onContext);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`stl-view-3d ${autoRotate ? "stl-view-auto" : ""}`.trim()} ref={containerRef}>
      <canvas ref={canvasRef} className="stl-canvas" />
      {!autoRotate && <span className="stl-view-hint muted">{t(`stl.controls.${controlMode}`)}</span>}
    </div>
  );
}
