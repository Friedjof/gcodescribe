/** Existing callers address a project; the profile editor addresses a profile explicitly. */
export type CalibrationTarget = string | { profileId: string };
export const targetBody = (
  target?: CalibrationTarget,
): { projectId?: string; profileId?: string } =>
  typeof target === "string" ? { projectId: target } : (target ?? {});
export function targetQuery(target?: CalibrationTarget): string {
  if (!target) return "";
  return typeof target === "string"
    ? `?project_id=${encodeURIComponent(target)}`
    : `?profile_id=${encodeURIComponent(target.profileId)}`;
}
