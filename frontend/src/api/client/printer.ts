import { targetBody, type CalibrationTarget } from "../calibrationTarget";
import { req } from "./req";
import type { Position, SerialPortCandidate } from "../types/jobs";
import type { PositionKind } from "../types/calibration";
import type { PrinterStatus, PrinterBackendId, PrinterBackendInfo, OctoPrintCheckResult, PrinterConnection, PrinterConnectionInput } from "../types/printer";

export const printerClient = {
  printerConnections: () => req<PrinterConnection[]>("/api/printer/connections"),
  savePrinterConnection: (data: PrinterConnectionInput, id?: string) =>
    req<PrinterConnection>(`/api/printer/connections${id ? `/${encodeURIComponent(id)}` : ""}`, {
      method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
  deletePrinterConnection: (id: string) => req(`/api/printer/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  octoStatus: () => req<PrinterStatus>("/api/printer/status"),
  octoprintCheck: () =>
    req<OctoPrintCheckResult>(
      "/api/printer/octoprint/check"
    ),
  listBackends: () =>
    req<PrinterBackendInfo[]>(
      "/api/printer/backends"
    ),
  setBackend: (id: PrinterBackendId) =>
    req<{ ok: boolean; active: PrinterBackendId }>("/api/printer/backend", {
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
    req<unknown>("/api/printer/send", {
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
  jog: (x: number, y: number, z: number, opts?: { speed?: number; limit?: "bed" | "plot"; projectId?: string; profileId?: string; pen_up_first?: boolean }) =>
    req("/api/printer/jog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, z, speed: opts?.speed, limit: opts?.limit ?? "bed", projectId: opts?.projectId, profileId: opts?.profileId, pen_up_first: opts?.pen_up_first }),
    }),
  home: (axes?: string[], projectId?: CalibrationTarget) =>
    req("/api/printer/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ axes, ...targetBody(projectId) }),
    }),
  pen: (down: boolean, projectId?: CalibrationTarget) =>
    req<{ ok: boolean; z: number; position: Position }>("/api/printer/pen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ down, ...targetBody(projectId) }),
    }),
  testDot: (target?: CalibrationTarget) =>
    req<{ ok: boolean; position: Position }>("/api/printer/test-dot", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetBody(target)),
    }),
  raisePen: (target?: CalibrationTarget) =>
    req<{ ok: boolean; position: Position }>("/api/printer/raise-pen", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetBody(target)),
    }),
  speedTest: (profileId: string) =>
    req<{ ok: boolean; size: number; travelFeed: number; position: Position }>("/api/printer/speed-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId }),
    }),
  position: (signal?: AbortSignal) => req<Position>("/api/position", { signal }),
  move: (x: number, y: number, projectId?: CalibrationTarget) =>
    req<{ ok: boolean; position: Position }>("/api/printer/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, ...targetBody(projectId) }),
    }),
  moveToCalibration: () =>
    req<{ ok: boolean; position: Position }>("/api/printer/move-to-calibration", {
      method: "POST",
    }),
  homeAndMoveToPosition: (kind: PositionKind, projectId?: CalibrationTarget, liftOnly = false) =>
    req<{ ok: boolean; position: Position }>("/api/printer/home-and-move-to-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, lift_only: liftOnly, ...targetBody(projectId) }),
    }),
  calibrationHeight: (profileId: string, offset: number, projectId?: string) =>
    req<{ ok: boolean; position: Position }>("/api/printer/calibration-height", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId, offset, project_id: projectId }),
    }),
  moveToPosition: (kind: PositionKind, target?: { x: number; y: number }, projectId?: CalibrationTarget, liftOnly = false) =>
    req<{ ok: boolean; position: Position }>("/api/printer/move-to-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...target, lift_only: liftOnly, ...targetBody(projectId) }),
    }),
  moveToCorner: (corner: string, target: "paper" | "plot" = "paper", projectId?: CalibrationTarget) =>
    req<{ ok: boolean; position: Position }>("/api/printer/move-to-corner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corner, target, ...targetBody(projectId) }),
    }),
};
