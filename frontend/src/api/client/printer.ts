import { req } from "./req";
import type { Position, SerialPortCandidate } from "../types/jobs";

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
  jog: (x: number, y: number, z: number, opts?: { speed?: number; limit?: "bed" | "plot" }) =>
    req("/api/printer/jog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, z, speed: opts?.speed, limit: opts?.limit ?? "bed" }),
    }),
  home: (axes?: string[]) =>
    req("/api/printer/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ axes }),
    }),
  pen: (down: boolean) =>
    req("/api/printer/pen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ down }),
    }),
  position: () => req<Position>("/api/position"),
  move: (x: number, y: number) =>
    req<{ ok: boolean; position: Position }>("/api/printer/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    }),
  moveToCorner: (corner: string, target: "paper" | "plot" = "paper") =>
    req<{ ok: boolean; position: Position }>("/api/printer/move-to-corner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corner, target }),
    }),
};
