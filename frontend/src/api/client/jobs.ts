import { req } from "./req";
import type { Job, GcodePreview, GcodePreview3D } from "../types/jobs";

export const jobsClient = {
  listJobs: () => req<Job[]>("/api/jobs"),
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
  testPattern: (name: string) =>
    req<Job>(`/api/testpattern/${name}`, { method: "POST" }),
  jobPreview: (filename: string) =>
    req<GcodePreview>(`/api/jobs/${encodeURIComponent(filename)}/preview`),
  jobPreview3D: (filename: string) =>
    req<GcodePreview3D>(`/api/jobs/${encodeURIComponent(filename)}/preview3d`),
};
