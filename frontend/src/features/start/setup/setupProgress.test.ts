import { expect, it } from "vitest";
import {
  calibrationReady,
  nextSetupStep,
  readSetupProgress,
  SETUP_STORAGE_KEY,
  writeSetupProgress,
} from "./setupProgress";
import type { CalibrationProfile } from "../../../api";
const profile = {
  id: "profile",
  fingerprint: "fp",
  calibration: {
    pen_calibrated: true,
    plot_width: 200,
    plot_height: 200,
    pen_up_z: 5,
    pen_down_z: 0,
  },
} as CalibrationProfile;
const storage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};
it("does not count an automatic default profile as completed setup", () => {
  const progress = readSetupProgress("project", "profile");
  expect(progress.confirmed).toBe(false);
  expect(nextSetupStep(progress, true, profile, 1)).toBe("profile");
});
it("keeps offline page preparation distinct from calibrated hardware", () => {
  const s = storage();
  writeSetupProgress(
    "project",
    {
      ...readSetupProgress("project", "profile"),
      confirmed: true,
      offline: true,
    },
    s,
  );
  const progress = readSetupProgress("project", "profile", s);
  expect(nextSetupStep(progress, false, profile, 1)).toBe("calibration");
  expect(
    nextSetupStep(
      { ...progress, calibrationFingerprint: "fp" },
      false,
      profile,
      0,
    ),
  ).toBe("drawing");
  expect(
    nextSetupStep(
      { ...progress, calibrationFingerprint: "fp" },
      false,
      profile,
      1,
    ),
  ).toBe("preview");
});
it("invalidates confirmation for a different project profile or changed calibration", () => {
  const s = storage(),
    progress = {
      ...readSetupProgress("a", "profile"),
      confirmed: true,
      calibrationFingerprint: "fp",
      finished: true,
    };
  writeSetupProgress("a", progress, s);
  expect(readSetupProgress("a", "other", s).confirmed).toBe(false);
  expect(readSetupProgress("b", "profile", s).confirmed).toBe(false);
  expect(
    nextSetupStep(progress, true, { ...profile, fingerprint: "changed" }, 1),
  ).toBe("calibration");
});
it("ignores corrupt and future storage, validates preview metadata and bounds history", () => {
  const s = storage();
  s.setItem(SETUP_STORAGE_KEY, "bad");
  expect(readSetupProgress("p", "x", s).confirmed).toBe(false);
  s.setItem(
    SETUP_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      projects: {
        p: {
          profileId: "x",
          preview: { pageId: "p", modified: "invalid", fingerprint: "x" },
        },
      },
    }),
  );
  expect(readSetupProgress("p", "x", s).preview).toBeNull();
  for (let i = 0; i < 70; i++)
    writeSetupProgress(`project-${i}`, readSetupProgress("p", "x"), s);
  expect(
    Object.keys(JSON.parse(s.getItem(SETUP_STORAGE_KEY)!).projects),
  ).toHaveLength(50);
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(() =>
    writeSetupProgress("p", readSetupProgress("p", "x"), blocked),
  ).not.toThrow();
});
it("requires real saved pen heights and a nondegenerate plot area", () => {
  expect(calibrationReady(profile)).toBe(true);
  for (const patch of [
    { pen_calibrated: false },
    { pen_up_z: 0 },
    { pen_down_z: 6 },
    { plot_width: 0 },
    { plot_height: NaN },
  ])
    expect(
      calibrationReady({
        ...profile,
        calibration: { ...profile.calibration, ...patch },
      }),
    ).toBe(false);
});
