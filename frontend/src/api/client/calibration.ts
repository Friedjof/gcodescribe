import { req } from "./req";
import type {
  Calibration,
  CalibrationProfile,
  CalibrationProfileSummary,
  ProfileImportResult,
} from "../types/calibration";

export const calibrationClient = {
  getCalibration: () => req<Calibration>("/api/calibration"),
  saveCalibration: (c: Partial<Calibration>) =>
    req<Calibration>("/api/calibration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    }),
  importCalibration: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<Calibration>("/api/calibration/import", { method: "POST", body: fd });
  },
  penFromPosition: (which: "up" | "down") =>
    req<Calibration>("/api/calibration/pen-from-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ which }),
    }),

  listProfiles: (includeArchived = true) =>
    req<CalibrationProfileSummary[]>(`/api/profiles?include_archived=${includeArchived}`),
  getProfile: (id: string) => req<CalibrationProfile>(`/api/profiles/${id}`),
  activeProfile: () => req<CalibrationProfile>("/api/profiles/active"),
  createProfile: (name?: string) =>
    req<CalibrationProfile>("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
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
