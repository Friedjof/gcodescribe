import { useEffect, useRef, useState } from "react";
import Gcode3D from "../components/Gcode3D";
import PolylinePreview from "../components/PolylinePreview";
import GamePreviewSvg from "../games/PreviewSvg";
import { useI18n } from "../i18n";
import SceneView, { defaultSceneViewBox, type ViewRotation } from "../paint/SceneView";
import type { DesignerSnapshot, StreamMessage } from "./protocol";

function wsUrl(path: string) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${path}`;
}

function hashParams() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

export default function LiveViewer() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"connecting" | "live" | "ended" | "error">("connecting");
  const [snapshot, setSnapshot] = useState<DesignerSnapshot | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; inside: boolean } | null>(null);
  const [clicks, setClicks] = useState<{ id: number; x: number; y: number }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastClickIdRef = useRef<number | undefined>(undefined);

  const clickStyle = (click: { x: number; y: number }) => {
    if (!snapshot || !svgRef.current) return { left: "50%", top: "50%" };
    const W = snapshot.cal.plot_width;
    const H = snapshot.cal.plot_height;
    const rotation = (snapshot.meta.viewRotation ?? 0) as ViewRotation;
    const [rx, ry] = rotatePoint([click.x * W, click.y * H], W, H, rotation);
    const viewBox = snapshot.meta.viewBox ?? defaultSceneViewBox(snapshot.cal, rotation);
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
    const renderedW = viewBox.w * scale;
    const renderedH = viewBox.h * scale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;
    return {
      left: `${offsetX + (rx - viewBox.x) * scale}px`,
      top: `${offsetY + (ry - viewBox.y) * scale}px`,
    };
  };

  useEffect(() => {
    const params = hashParams();
    const sessionId = params.get("s");
    const token = params.get("k");
    if (!sessionId || !token) {
      setStatus("error");
      return;
    }
    const ws = new WebSocket(wsUrl(`/api/stream/ws/view/${sessionId}`));
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ v: 1, t: "join", ts: Date.now(), token } satisfies StreamMessage));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as StreamMessage;
      if (message.t === "hello" || message.t === "snapshot") {
        setSnapshot(message.snapshot);
        setStatus("live");
      } else if (message.t === "cursor") {
        setCursor({ x: message.x, y: message.y, inside: message.inside });
        if (message.clickId != null && message.clickId !== lastClickIdRef.current) {
          lastClickIdRef.current = message.clickId;
          const id = Date.now() + message.clickId;
          setClicks((prev) => [...prev.slice(-5), { id, x: message.x, y: message.y }]);
          window.setTimeout(() => setClicks((prev) => prev.filter((click) => click.id !== id)), 900);
        }
      } else if (message.t === "click") {
        const id = Date.now();
        setClicks((prev) => [...prev.slice(-5), { id, x: message.x, y: message.y }]);
        window.setTimeout(() => setClicks((prev) => prev.filter((click) => click.id !== id)), 760);
      } else if (message.t === "ended") {
        setStatus("ended");
      }
    };
    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus((current) => current === "live" ? "ended" : current);
    return () => ws.close();
  }, []);

  return (
    <main className="live-viewer">
      {status === "ended" || snapshot?.meta.mode === "placeholder" ? (
        <div className="live-placeholder">
          <div className="live-placeholder-mark">✎</div>
          <h1>{t("live.viewer.readyTitle")}</h1>
          <p>{status === "ended" ? t("live.viewer.ended") : t("live.viewer.sessionActive")} {t("live.viewer.autoResume")}</p>
        </div>
      ) : status !== "live" && (
        <div className="live-viewer-status">
          <strong>{status === "connecting" ? t("live.viewer.connecting") : t("live.viewer.unavailable")}</strong>
          <span>{t("live.viewer.restartHint")}</span>
        </div>
      )}
      {status === "live" && snapshot?.meta.mode === "gcode3d" && snapshot.gcode3d && (
        <div className="live-viewer-gcode3d">
          <Gcode3D data={snapshot.gcode3d} chrome={false} showTravels viewState={snapshot.gcode3dView ?? undefined} />
          <div className="live-gcode3d-label">{t("live.viewer.gcode3d")}</div>
        </div>
      )}
      {status === "live" && snapshot?.meta.mode === "game" && snapshot.game && (
        <div className="live-viewer-game">
          <GamePreviewSvg cal={snapshot.cal} lines={snapshot.game.lines} solutionLines={snapshot.game.solutionLines} className="live-game-preview" />
          <div className="live-gcode3d-label">{snapshot.game.name}</div>
        </div>
      )}
      {status === "live" && snapshot?.meta.mode === "gallery" && snapshot.gallery?.preview && (
        <div className="live-viewer-gallery">
          <PolylinePreview data={snapshot.gallery.preview} className="live-gallery-preview" stroke="var(--busy)" />
          <div className="live-gcode3d-label">{snapshot.gallery.title}</div>
        </div>
      )}
      {status === "live" && snapshot && snapshot.meta.mode !== "gcode3d" && snapshot.meta.mode !== "game" && snapshot.meta.mode !== "gallery" && (
        <div className="live-viewer-canvas">
          <SceneView ref={svgRef} cal={snapshot.cal} page={snapshot.page} viewBox={snapshot.meta.viewBox} viewRotation={snapshot.meta.viewRotation ?? 0} showGrid={false}>
            {cursor?.inside && (
              <g className="live-cursor-svg" transform={`translate(${cursor.x * snapshot.cal.plot_width} ${cursor.y * snapshot.cal.plot_height})`}>
                <circle className="live-cursor-ring" r={Math.max(snapshot.cal.plot_width, snapshot.cal.plot_height) * 0.012} />
                <circle className="live-cursor-center" r={Math.max(snapshot.cal.plot_width, snapshot.cal.plot_height) * 0.0035} />
              </g>
            )}
          </SceneView>
          <div className="live-click-layer">
            {clicks.map((click) => (
              <span key={click.id} className="live-click-pop" style={clickStyle(click)}>
                <i className="core" />
                <i className="ring ring-a" />
                <i className="ring ring-b" />
                <i className="spark s1" />
                <i className="spark s2" />
                <i className="spark s3" />
                <i className="spark s4" />
              </span>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function rotatePoint([x, y]: [number, number], W: number, H: number, deg: ViewRotation): [number, number] {
  const cx = W / 2;
  const cy = H / 2;
  const dx = x - cx;
  const dy = y - cy;
  if (deg === 90) return [cx - dy, cy + dx];
  if (deg === 180) return [cx - dx, cy - dy];
  if (deg === 270) return [cx + dy, cy - dx];
  return [x, y];
}
