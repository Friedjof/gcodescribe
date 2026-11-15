import { req } from "./req";
import type { Position, SerialPortCandidate } from "../types/jobs";
import type { PositionKind } from "../types/calibration";

export const printerClient = {
  octoStatus: () => req<any>("/api/printer/status"),
  octoprintCheck: () =>
    req<{ ok: boolean; version?: string; api?: string; error?: string }>(
      "/api/printer/octoprint/check"
    ),
  listBackends: () =>
    req<Array<{ id: string; configured: boolean; online: boolean; active: boolean }>>(
      "/api/printer/backends"
    ),
  setBackend: (id: string) =>
    req<{ ok: boolean; active: string }>("/api/printer/backend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  listSerialPorts: () => req<SerialPortCandidate[]>("/api/printer/serial/ports"),
  probeSerialPort: (device: string) =>
    req<{ device: string; marlin: boolean; firmware: string | null; error?: string }>(
      "/api/printer/serial/probe",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device }),
      }
    ),
  send: (filename: string, start: boolean) =>
    req<any>("/api/printer/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, start }),
    }),
  jobCommand: (command: string) =>
    req("/api/printer/job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    }),
  jog: (x: number, y: number, z: number, opts?: { speed?: number; limit?: "bed" | "plot"; projectId?: string }) =>
    req("/api/printer/jog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, z, speed: opts?.speed, limit: opts?.limit ?? "bed", projectId: opts?.projectId }),
    }),
  home: (axes?: string[], projectId?: string) =>
    req("/api/printer/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ axes, projectId }),
    }),
  pen: (down: boolean, projectId?: string) =>
    req<{ ok: boolean; z: number; position: Position }>("/api/printer/pen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ down, projectId }),
    }),
  speedTest: (profileId: string) =>
    req<{ ok: boolean; size: number; travelFeed: number; position: Position }>("/api/printer/speed-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId }),
    }),
  position: () => req<Position>("/api/position"),
  move: (x: number, y: number, projectId?: string) =>
    req<{ ok: boolean; position: Position }>("/api/printer/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, projectId }),
    }),
  moveToCalibration: () =>
    req<{ ok: boolean; position: Position }>("/api/printer/move-to-calibration", {
      method: "POST",
    }),
  homeAndMoveToPosition: (kind: PositionKind, projectId?: string) =>
    req<{ ok: boolean; position: Position }>("/api/printer/home-and-move-to-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, projectId }),
    }),
  calibrationHeight: (profileId: string, offset: number, projectId?: string) =>
    req<{ ok: boolean; position: Position }>("/api/printer/calibration-height", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId, offset, project_id: projectId }),
    }),
  moveToPosition: (kind: PositionKind, target?: { x: number; y: number }, projectId?: string) =>
    req<{ ok: boolean; position: Position }>("/api/printer/move-to-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...target, projectId }),
    }),
  moveToCorner: (corner: string, target: "paper" | "plot" = "paper", projectId?: string) =>
    req<{ ok: boolean; position: Position }>("/api/printer/move-to-corner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corner, target, projectId }),
    }),
};
