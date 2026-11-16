import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CalibrationProfile, type PaperState } from "../../../api";
import { ApiError, errorMessage, isAbortError } from "../../../api/errors";
import { useProjectCalibration } from "../../../state/ProjectCalibrationContext";
import { paperRect } from "../../../lib/paperGeometry";

/** The setup uses its project; the profile editor uses an explicit, independent profile. */
export function useCalibrationSource(
  profileId: string | undefined,
  visible: boolean,
) {
  const project = useProjectCalibration();
  const [snapshot, setSnapshot] = useState<{
    profile: CalibrationProfile | null;
    paper: PaperState | null;
    loading: boolean;
    error: string | null;
    readOnly: boolean;
  }>({
    profile: null,
    paper: null,
    loading: true,
    error: null,
    readOnly: false,
  });
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (_force?: boolean) => {
      if (!profileId) return;
      controller.current?.abort();
      const read = new AbortController();
      controller.current = read;
      setSnapshot((value) => ({ ...value, loading: true, error: null }));
      try {
        let data: { profile: CalibrationProfile; paper: PaperState };
        let readOnly = false;
        try {
          data = await api.profileCalibration(profileId, read.signal);
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            ![404, 405].includes(error.status)
          )
            throw error;
          // Old servers ignore unknown query parameters. Never use their global
          // paper data or permit profile-scoped commands against those routes.
          const profile = await api.getProfile(profileId, read.signal);
          data = {
            profile,
            paper: {
              calibration: profile.calibration,
              rect: paperRect(profile.calibration),
            },
          };
          readOnly = true;
        }
        if (read.signal.aborted) return;
        if (data.profile.id !== profileId)
          throw new Error(
            "Das angeforderte Profil konnte nicht geladen werden.",
          );
        setSnapshot({ ...data, readOnly, loading: false, error: null });
      } catch (error) {
        if (!read.signal.aborted && !isAbortError(error))
          setSnapshot({
            readOnly: true,
            profile: null,
            paper: null,
            loading: false,
            error: errorMessage(error),
          });
      }
    },
    [profileId],
  );
  useEffect(() => {
    if (profileId && visible) void refresh();
    return () => controller.current?.abort();
  }, [profileId, visible, project.profileRevision, refresh]);
  if (!profileId) return { ...project, readOnly: false };
  const matches = snapshot.profile?.id === profileId;
  return {
    ...project,
    index: null,
    profile: matches ? snapshot.profile : null,
    paper: matches ? snapshot.paper : null,
    loading: snapshot.loading || !matches,
    error: snapshot.error,
    readOnly: snapshot.readOnly,
    refresh,
  };
}
