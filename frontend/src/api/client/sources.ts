import { req } from "./req";
import type { Source, SourcePreview } from "../types/sources";
import type { Job } from "../types/jobs";
import type { PageScore } from "../types/paint";

export const sourcesClient = {
  createSource: (file: File, mode: "auto" | "vector" | "trace" | "edges" | "hatch" | "lines" | "dots" | "handwriting", detail: number) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    fd.append("detail", String(detail));
    return req<Source>("/api/sources", { method: "POST", body: fd });
  },
  listSources: () => req<Source[]>("/api/sources"),
  deleteSource: (id: string) =>
    req(`/api/sources/${id}`, { method: "DELETE" }),
  sourcePreview: (id: string, page: number, maxPoints?: number) =>
    req<SourcePreview>(`/api/sources/${id}/preview/${page}${maxPoints ? `?max_points=${maxPoints}` : ""}`),
  sourceThumbnail: (id: string) =>
    req<SourcePreview>(`/api/sources/${id}/thumbnail`),
  sourceThumbnails: () =>
    req<Record<string, SourcePreview>>(`/api/sources/thumbnails`),
  sourceGcode: (id: string, page: number, x: number, y: number, width: number) =>
    req<Job>(`/api/sources/${id}/gcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, x, y, width }),
    }),
  sourceScore: (id: string, page: number, x: number, y: number, width: number) =>
    req<PageScore>(`/api/sources/${id}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, x, y, width }),
    }),
};
