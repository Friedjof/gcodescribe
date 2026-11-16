import { targetBody, targetQuery, type CalibrationTarget } from "../calibrationTarget";
import type { PaperState } from "../types/jobs";
import { req } from "./req";
import type {
  Calibration,
  CalibrationProfile,
  CalibrationProfileSummary,
  ProfileImportResult,
  PositionKind,
} from "../types/calibration";


export const calibrationClient = {
  getCalibration: (projectId?: CalibrationTarget) => req<Calibration>(`/api/calibration${targetQuery(projectId)}`),
  saveCalibration: (c: Partial<Calibration>, projectId?: CalibrationTarget) =>
    req<Calibration>(`/api/calibration${targetQuery(projectId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    }),
  importCalibration: (file: File, target?: CalibrationTarget) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<Calibration>(`/api/calibration/import${targetQuery(target)}`, { method: "POST", body: fd });
  },
  penFromPosition: (which: "up" | "down", projectId?: CalibrationTarget) =>
    req<Calibration>("/api/calibration/pen-from-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ which, ...targetBody(projectId) }),
    }),
  positionFromHead: (kind: PositionKind, projectId?: CalibrationTarget) =>
    req<Calibration>("/api/calibration/position-from-head", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...targetBody(projectId) }),
    }),

  listProfiles: (includeArchived = true) =>
    req<CalibrationProfileSummary[]>(`/api/profiles?include_archived=${includeArchived}`),
  getProfile: (id: string, signal?: AbortSignal) => req<CalibrationProfile>(`/api/profiles/${id}`, { signal }),
  profileCalibration: (id: string, signal?: AbortSignal) =>
    req<{ profile: CalibrationProfile; paper: PaperState }>(`/api/profiles/${encodeURIComponent(id)}/calibration-state`, { signal }),
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
