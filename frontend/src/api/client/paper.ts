import { req } from "./req";
import type { PaperState } from "../types/jobs";
import type { Obstacle } from "../types/calibration";

export const paperClient = {
  paper: () => req<PaperState>("/api/paper"),
  setCorner: (corner: string) =>
    req<PaperState>("/api/paper/corner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corner }),
    }),
  setCornerAt: (corner: string, x: number, y: number) =>
    req<PaperState>(`/api/paper/corner/${corner}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    }),
  clearCorner: (corner: string) =>
    req<PaperState>(`/api/paper/corner/${corner}`, { method: "DELETE" }),
  resetPaper: () => req<PaperState>("/api/paper", { method: "DELETE" }),
  applyPaper: (margin: number) =>
    req<PaperState>("/api/paper/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ margin }),
    }),
  setObstacles: (obstacles: Obstacle[]) =>
    req<PaperState>("/api/paper/obstacles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obstacles }),
    }),
};
