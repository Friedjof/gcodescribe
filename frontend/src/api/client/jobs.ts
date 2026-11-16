import { targetQuery, type CalibrationTarget } from "../calibrationTarget";
import { req } from "./req";
import type { Job, GcodePreview, GcodePreview3D } from "../types/jobs";

export const jobsClient = {
  listJobs: (signal?: AbortSignal) => req<Job[]>("/api/jobs", { signal }),
  deleteJob: (name: string) =>
    req(`/api/jobs/${encodeURIComponent(name)}`, { method: "DELETE" }),
  renameJob: (name: string, newName: string) =>
    req<Job>(`/api/jobs/${encodeURIComponent(name)}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    }),
  convert: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ files: Job[] }>("/api/convert", { method: "POST", body: fd });
  },
  testPattern: (name: string, projectId?: CalibrationTarget) =>
    req<Job>(`/api/testpattern/${name}${targetQuery(projectId)}`, { method: "POST" }),
  jobPreview: (filename: string, signal?: AbortSignal) =>
    req<GcodePreview>(`/api/jobs/${encodeURIComponent(filename)}/preview`, { signal }),
  jobPreview3D: (filename: string, signal?: AbortSignal) =>
    req<GcodePreview3D>(`/api/jobs/${encodeURIComponent(filename)}/preview3d`, { signal }),
};
