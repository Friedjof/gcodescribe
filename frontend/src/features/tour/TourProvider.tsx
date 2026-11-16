import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WorkspaceId } from "../../interface/workspaces";
import type { SetupStep } from "../start/setup/setupProgress";
import type { CalibrationStep } from "../control/calibration/steps";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";
import { useSetupProgress } from "../start/setup/useSetupProgress";
import { readTour, TOUR_STEPS, writeTour, type TourStep } from "./tourModel";
import TourOverlay from "./TourOverlay";

interface TourContextValue {
  step: TourStep | null;
  request: number;
  offer: () => void;
  followSetup: (step: SetupStep) => void;
  followCalibration: (step: CalibrationStep | null) => void;
}
const Context = createContext<TourContextValue | null>(null);
/** Optional so independently rendered editor views do not depend on onboarding. */
export const useAppTour = () => useContext(Context);
export default function TourProvider({
  children,
  onNavigate,
  blocked,
  printerBusy = false,
  activeWorkspace,
  onEnd,
}: {
  children: ReactNode;
  onNavigate: (workspace: WorkspaceId) => void;
  blocked: boolean;
  printerBusy?: boolean;
  activeWorkspace?: WorkspaceId;
  onEnd?: () => void;
}) {
  const { index, profile } = useProjectCalibration();
  const { progress } = useSetupProgress(
    index?.project?.id ?? "",
    profile?.id ?? "",
  );
  const [record] = useState(() => {
    try {
      return readTour(localStorage);
    } catch {
      return null;
    }
  });
  const [offered, setOffered] = useState(false);
  const [active, setActive] = useState(false);
  const [current, setCurrent] = useState(
    record?.state === "progress" ? record.step : 0,
  );
  const [request, setRequest] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [resumeAvailable, setResumeAvailable] = useState(
    record?.state === "progress",
  );
  const opener = useRef<HTMLElement | null>(null);
  const step = active ? TOUR_STEPS[current] : null;
  const offer = useCallback(() => {
    let saved = null;
    try {
      saved = readTour(localStorage);
    } catch {
      /* Storage can be restricted. */
    }
    setCurrent(saved?.state === "progress" ? saved.step : 0);
    setResumeAvailable(saved?.state === "progress");
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setWelcome(true);
    setOffered(true);
  }, []);
  useEffect(() => {
    if (offered || blocked || printerBusy || !index?.project || !profile)
      return;
    if (
      record?.state === "finished" ||
      record?.state === "dismissed" ||
      (progress.confirmed && record?.state !== "progress")
    ) {
      setOffered(true);
      return;
    }
    offer();
  }, [
    index?.project?.id,
    profile?.id,
    progress.confirmed,
    offered,
    blocked,
    printerBusy,
    record,
    offer,
  ]);
  useEffect(() => {
    if (step && !blocked && !printerBusy && !minimized)
      onNavigate(step.workspace);
  }, [step, blocked, printerBusy, onNavigate, request, minimized]);
  useEffect(() => {
    if (step && activeWorkspace && activeWorkspace !== step.workspace)
      setMinimized(true);
  }, [activeWorkspace]);
  const move = useCallback((next: number) => {
    const bounded = Math.max(0, Math.min(TOUR_STEPS.length - 1, next));
    setCurrent(bounded);
    setRequest((value) => value + 1);
    setMinimized(false);
    writeTour({ version: 1, state: "progress", step: bounded });
  }, []);
  const stop = (finished: boolean) => {
    writeTour({
      version: 1,
      state: finished ? "finished" : "dismissed",
      step: current,
    });
    setWelcome(false);
    setActive(false);
    setMinimized(false);
    onEnd?.();
    // Wait for temporary tour tabs to disappear before restoring keyboard focus.
    requestAnimationFrame(() => {
      if (opener.current?.isConnected)
        opener.current.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>('.workspace-tabs [aria-selected="true"]')
          ?.focus({ preventScroll: true });
    });
  };
  const value = useMemo<TourContextValue>(
    () => ({
      step,
      request,
      offer,
      followSetup: (setup) => {
        if (!step?.setup || step.setup === setup) return;
        const next = TOUR_STEPS.findIndex((item) => item.setup === setup);
        if (next >= 0) move(next);
      },
      followCalibration: (calibration) => {
        if (
          !step?.calibration ||
          !calibration ||
          step.calibration === calibration
        )
          return;
        const next = TOUR_STEPS.findIndex(
          (item) => item.calibration === calibration,
        );
        if (next >= 0) move(next);
      },
    }),
    [step, request, offer, move],
  );
  return (
    <Context.Provider value={value}>
      {children}
      <TourOverlay
        welcome={welcome}
        step={step}
        current={current}
        resumable={resumeAvailable && current > 0}
        paused={blocked || printerBusy}
        minimized={minimized}
        onStart={() => {
          setWelcome(false);
          setActive(true);
          move(current);
        }}
        onRestart={() => {
          setWelcome(false);
          setActive(true);
          move(0);
        }}
        onClose={() => stop(false)}
        onFinish={() => {
          onNavigate("paper");
          stop(true);
        }}
        onBack={() => move(current - 1)}
        onNext={() => move(current + 1)}
        onMinimize={() => setMinimized(true)}
        onRestore={() => {
          setMinimized(false);
          setRequest((value) => value + 1);
        }}
      />
    </Context.Provider>
  );
}
