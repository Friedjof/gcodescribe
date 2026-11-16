import { req } from "./req";
import type {
  Calibration,
  CalibrationProfile,
  CalibrationProfileSummary,
  ProfileImportResult,
  PositionKind,
} from "../types/calibration";

const projectQuery = (projectId?: string) => projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";

export const calibrationClient = {
  getCalibration: (projectId?: string) => req<Calibration>(`/api/calibration${projectQuery(projectId)}`),
  saveCalibration: (c: Partial<Calibration>, projectId?: string) =>
    req<Calibration>(`/api/calibration${projectQuery(projectId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    }),
  importCalibration: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<Calibration>("/api/calibration/import", { method: "POST", body: fd });
  },
  penFromPosition: (which: "up" | "down", projectId?: string) =>
    req<Calibration>("/api/calibration/pen-from-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ which, projectId }),
    }),
  positionFromHead: (kind: PositionKind, projectId?: string) =>
    req<Calibration>("/api/calibration/position-from-head", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, projectId }),
    }),

  listProfiles: (includeArchived = true) =>
    req<CalibrationProfileSummary[]>(`/api/profiles?include_archived=${includeArchived}`),
  getProfile: (id: string, signal?: AbortSignal) => req<CalibrationProfile>(`/api/profiles/${id}`, { signal }),
  activeProfile: (signal?: AbortSignal) => req<CalibrationProfile>("/api/profiles/active", { signal }),
  createProfile: (name?: string, calibration?: Partial<Calibration>) =>
    req<CalibrationProfile>("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, calibration }),
    }),
  saveProfile: (id: string, updates: { name?: string; calibration?: Partial<Calibration> }) =>
    req<CalibrationProfile>(`/api/profiles/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }),
  activateProfile: (id: string) =>
    req<CalibrationProfile>(`/api/profiles/${id}/activate`, { method: "POST" }),
  duplicateProfile: (id: string, name?: string) =>
    req<CalibrationProfile>(`/api/profiles/${id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  archiveProfile: (id: string, archived: boolean) =>
    req<CalibrationProfile>(`/api/profiles/${id}/${archived ? "archive" : "unarchive"}`, {
      method: "POST",
    }),
  importProfile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<CalibrationProfile>("/api/profiles/import", { method: "POST", body: fd });
  },
  importAllProfiles: (file: File, replace = false) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("replace", String(replace));
    return req<ProfileImportResult>("/api/profiles/import-all", { method: "POST", body: fd });
  },
};
