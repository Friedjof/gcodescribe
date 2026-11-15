import { req } from "./req";
import type { PaperState } from "../types/jobs";
import type { Obstacle } from "../types/calibration";

const projectQuery = (projectId?: string) => projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";

export const paperClient = {
  paper: (projectId?: string) => req<PaperState>(`/api/paper${projectQuery(projectId)}`),
  setCorner: (corner: string, projectId?: string) =>
    req<PaperState>(`/api/paper/corner${projectQuery(projectId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corner }),
    }),
  setCornerAt: (corner: string, x: number, y: number, projectId?: string) =>
    req<PaperState>(`/api/paper/corner/${corner}${projectQuery(projectId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    }),
  clearCorner: (corner: string, projectId?: string) =>
    req<PaperState>(`/api/paper/corner/${corner}${projectQuery(projectId)}`, { method: "DELETE" }),
  resetPaper: (projectId?: string) => req<PaperState>(`/api/paper${projectQuery(projectId)}`, { method: "DELETE" }),
  applyPaper: (margin: number, projectId?: string, fromPaper = false) =>
    req<PaperState>(`/api/paper/apply${projectQuery(projectId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ margin, from_paper: fromPaper }),
    }),
  setObstacles: (obstacles: Obstacle[], projectId?: string) =>
    req<PaperState>(`/api/paper/obstacles${projectQuery(projectId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obstacles }),
    }),
};
