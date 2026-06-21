import type { Calibration, GcodePreview3D, Page } from "../api";
import type { Gcode3DView } from "../components/Gcode3D";

export type StreamState = "idle" | "connecting" | "live" | "error";

export interface StreamMeta {
  sourceId: string;
  pageName?: string;
  viewBox?: { x: number; y: number; w: number; h: number };
  viewRotation?: 0 | 90 | 180 | 270;
  mode?: "canvas" | "gcode3d";
}

export interface DesignerSnapshot {
  cal: Calibration;
  page: Pick<Page, "id" | "name" | "objects" | "grid">;
  meta: StreamMeta;
  gcode3d?: GcodePreview3D | null;
  gcode3dView?: Gcode3DView | null;
}

export type StreamMessage =
  | { v: 1; t: "hello" | "snapshot"; ts: number; sourceId: string; meta: StreamMeta; snapshot: DesignerSnapshot }
  | { v: 1; t: "cursor"; ts: number; x: number; y: number; inside: boolean; tool?: string; clickId?: number }
  | { v: 1; t: "click"; ts: number; x: number; y: number; tool?: string }
  | { v: 1; t: "join"; ts: number; token: string }
  | { v: 1; t: "presence"; ts: number; viewers: number }
  | { v: 1; t: "ready"; ts: number; sourceId: string; meta?: StreamMeta | null }
  | { v: 1; t: "accepted"; ts: number; sessionId: string }
  | { v: 1; t: "ended"; ts: number; reason: string }
  | { v: 1; t: "bye"; ts: number; reason: string }
  | { v: 1; t: "ping" | "pong"; ts: number };

export interface StreamSessionStart {
  sessionId: string;
  viewerToken: string;
  viewerUrl: string;
}
