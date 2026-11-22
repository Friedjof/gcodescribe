import { targetQuery, type CalibrationTarget } from "../calibrationTarget";
import { req } from "./req";
import type { PaperState } from "../types/jobs";
import type { Obstacle } from "../types/calibration";


export const paperClient = {
  paper: (projectId?: CalibrationTarget, signal?: AbortSignal) => req<PaperState>(`/api/paper${targetQuery(projectId)}`, { signal }),
  setCorner: (corner: string, projectId?: CalibrationTarget, capture?: { mode: "manual" | "diagonal"; diagonal: "bl-tr" | "tl-br" }) =>
    req<PaperState>(`/api/paper/corner${targetQuery(projectId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corner, ...capture }),
    }),
  setCornerAt: (corner: string, x: number, y: number, projectId?: CalibrationTarget) =>
    req<PaperState>(`/api/paper/corner/${corner}${targetQuery(projectId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    }),
  clearCorner: (corner: string, projectId?: CalibrationTarget) =>
    req<PaperState>(`/api/paper/corner/${corner}${targetQuery(projectId)}`, { method: "DELETE" }),
  resetPaper: (projectId?: CalibrationTarget) => req<PaperState>(`/api/paper${targetQuery(projectId)}`, { method: "DELETE" }),
  applyPaper: (margin: number, projectId?: CalibrationTarget, fromPaper = false) =>
    req<PaperState>(`/api/paper/apply${targetQuery(projectId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ margin, from_paper: fromPaper }),
    }),
  setObstacles: (obstacles: Obstacle[], projectId?: CalibrationTarget) =>
    req<PaperState>(`/api/paper/obstacles${targetQuery(projectId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obstacles }),
    }),
};
