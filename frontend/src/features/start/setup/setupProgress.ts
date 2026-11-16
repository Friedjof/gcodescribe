import type { CalibrationProfile } from "../../../api";
export const SETUP_STORAGE_KEY = "gcs.setup.v1";
export const SETUP_STEPS = [
  "profile",
  "connection",
  "calibration",
  "drawing",
  "preview",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export interface SetupProgress {
  profileId: string;
  confirmed: boolean;
  offline: boolean;
  calibrationFingerprint: string | null;
  preview: { pageId: string; modified: number; fingerprint: string } | null;
  finished: boolean;
}
const fresh = (profileId: string): SetupProgress => ({
  profileId,
  confirmed: false,
  offline: false,
  calibrationFingerprint: null,
  preview: null,
  finished: false,
});
export function readSetupProgress(
  projectId: string,
  profileId: string,
  storage?: Pick<Storage, "getItem">,
): SetupProgress {
  try {
    const root = JSON.parse(storage?.getItem(SETUP_STORAGE_KEY) ?? "null"),
      value = root?.version === 1 ? root.projects?.[projectId] : null;
    if (!value || value.profileId !== profileId) return fresh(profileId);
    const preview = value.preview;
    return {
      profileId,
      confirmed: value.confirmed === true,
      offline: value.offline === true,
      finished: value.finished === true,
      calibrationFingerprint:
        typeof value.calibrationFingerprint === "string"
          ? value.calibrationFingerprint
          : null,
      preview:
        preview &&
        typeof preview.pageId === "string" &&
        Number.isFinite(preview.modified) &&
        typeof preview.fingerprint === "string"
          ? preview
          : null,
    };
  } catch {
    return fresh(profileId);
  }
}
export function writeSetupProgress(
  projectId: string,
  progress: SetupProgress,
  storage?: Pick<Storage, "getItem" | "setItem">,
) {
  try {
    const previous = JSON.parse(storage?.getItem(SETUP_STORAGE_KEY) ?? "null");
    const projects =
      previous?.version === 1 &&
      previous.projects &&
      typeof previous.projects === "object"
        ? previous.projects
        : {};
    // Bounded local history; settings never contain credentials or document content.
    delete projects[projectId];
    storage?.setItem(
      SETUP_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        projects: Object.fromEntries([
          ...Object.entries(projects).slice(-49),
          [projectId, progress],
        ]),
      }),
    );
  } catch {
    /* The current setup flow remains usable without persistent storage. */
  }
}
export function calibrationReady(profile: CalibrationProfile | null): boolean {
  const cal = profile?.calibration;
  return (
    !!cal?.pen_calibrated &&
    [cal.plot_width, cal.plot_height, cal.pen_up_z, cal.pen_down_z].every(
      Number.isFinite,
    ) &&
    cal.plot_width >= 5 &&
    cal.plot_height >= 5 &&
    cal.pen_up_z > cal.pen_down_z
  );
}
export function nextSetupStep(
  progress: SetupProgress,
  online: boolean,
  profile: CalibrationProfile | null,
  objectCount: number,
): SetupStep {
  if (!progress.confirmed) return "profile";
  if (!online && !progress.offline) return "connection";
  if (
    !calibrationReady(profile) ||
    progress.calibrationFingerprint !== profile?.fingerprint
  )
    return "calibration";
  return objectCount > 0 ? "preview" : "drawing";
}
