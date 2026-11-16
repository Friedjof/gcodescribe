import { useAppTour } from "../../tour/TourProvider";
import { useEffect, useRef, useState } from "react";
import type {
  CalibrationProfile,
  PageIndex,
  PrinterStatus,
} from "../../../api";
import EditorIcon, {
  type EditorIconName,
} from "../../../components/editor/EditorIcon";
import { useI18n } from "../../../i18n";
import { isPrinterBusy } from "../../../lib/printerState";
import { useProjectCalibration } from "../../../state/ProjectCalibrationContext";
import Paper from "../../control/Paper";
import SetupProfileStep from "./SetupProfileStep";
import SetupConnectionStep from "./SetupConnectionStep";
import SetupDrawingStep from "./SetupDrawingStep";
import SetupPreviewStep from "./SetupPreviewStep";
import {
  calibrationReady,
  nextSetupStep,
  SETUP_STEPS,
  type SetupStep,
} from "./setupProgress";
import { useSetupProgress } from "./useSetupProgress";
import type { WorkspaceId } from "../../../interface/workspaces";

const STEP_ICONS: Record<SetupStep, EditorIconName> = {
  profile: "settings",
  connection: "plug",
  calibration: "measure",
  drawing: "draw",
  preview: "preview",
};

/** The guide composes existing profile, connection, calibration and document APIs. */
export default function SetupGuide({
  index,
  profile,
  status,
  visible,
  onSettings,
  onNavigate,
  onAction,
}: {
  index: PageIndex;
  profile: CalibrationProfile;
  status: PrinterStatus | null;
  visible: boolean;
  onSettings: () => void;
  onNavigate: (id: WorkspaceId) => void;
  onAction: () => void;
}) {
  const tour = useAppTour();
  const { t } = useI18n(),
    { refresh, setIndex } = useProjectCalibration(),
    project = index.project!;
  const { progress, update, confirmProject } = useSetupProgress(
    project.id,
    profile.id,
  );
  const drawing = index.order.find((page) => page.id === index.activeId),
    online = !!status?.online;
  const [step, setStep] = useState<SetupStep>(() =>
    nextSetupStep(progress, online, profile, drawing?.objectCount ?? 0),
  );
  const [expanded, setExpanded] = useState(!progress.finished),
    [calibrationConfirmed, setCalibrationConfirmed] = useState(false);
  useEffect(() => setCalibrationConfirmed(false), [profile.fingerprint]);
  const calibrated =
    calibrationReady(profile) &&
    progress.calibrationFingerprint === profile.fingerprint;
  const reviewed =
    !!drawing &&
    progress.preview?.pageId === drawing.id &&
    progress.preview.modified === drawing.modified &&
    progress.preview.fingerprint === profile.fingerprint;
  const completed = {
    profile: progress.confirmed,
    connection: online,
    calibration: calibrated,
    drawing: !!drawing?.objectCount,
    preview: reviewed,
  };
  const ready = online && calibrated && progress.confirmed && reviewed;
  const choose = (next: SetupStep) => {
    setStep(next);
    setExpanded(true);
    tour?.followSetup(next);
  };
  const tourWasActive = useRef(false);
  useEffect(() => {
    if (tour?.step?.setup) {
      tourWasActive.current = true;
      setStep(tour.step.setup); setExpanded(true);
    } else if (tourWasActive.current) {
      tourWasActive.current = false;
      setStep(nextSetupStep(progress, online, profile, drawing?.objectCount ?? 0));
      setExpanded(!progress.finished);
    }
  }, [tour?.request, tour?.step?.id]);
  const useExisting = () => {
    update((p) => ({ ...p, confirmed: true, finished: false }));
    choose("connection");
  };
  const created = (next: PageIndex) => {
    if (!next.project) return;
    confirmProject(next.project.id, next.project.profileId);
    setIndex(next);
    tour?.followSetup("connection");
  };
  return (
    <section
      className={`setup-guide${expanded ? " expanded" : ""}`}
      aria-label={t("start.setupTitle")}
    >
      <div className="setup-guide-heading">
        <div>
          <h2>
            {t(
              progress.finished
                ? ready
                  ? "setup.readyTitle"
                  : "setup.preparedTitle"
                : "workspace.paper",
            )}
          </h2>
          <small title={project.name}>{project.name}</small>
        </div>
        {progress.finished && (
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {t(expanded ? "setup.collapse" : "setup.resume")}
          </button>
        )}
      </div>
      <ol className="setup-stepper">
        {SETUP_STEPS.map((id, i) => (
          <li
            key={id}
            className={`${step === id && expanded ? "active " : ""}${completed[id] ? "complete" : ""}`}
          >
            <button
              type="button"
              aria-current={expanded && step === id ? "step" : undefined}
              disabled={id !== "profile" && !progress.confirmed}
              onClick={() => choose(id)}
            >
              <span className="setup-step-number">
                {completed[id] ? <EditorIcon name="check" size={17} /> : <EditorIcon name={STEP_ICONS[id]} size={18} />}
              </span>
              <span>
                {i + 1}. {t(`setup.step.${id}`)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {expanded && (
        <div className={`setup-guide-body setup-stage-${step}`}>
          {step === "profile" && (
            <SetupProfileStep
              index={index}
              profile={profile}
              active={visible}
              locked={isPrinterBusy(status)}
              onUse={useExisting}
              onCreated={created}
            />
          )}
          {step === "connection" && (
            <SetupConnectionStep
              status={status}
              onSettings={onSettings}
              onNext={() => choose("calibration")}
              onOffline={() => {
                update((p) => ({ ...p, offline: true }));
                choose("calibration");
              }}
            />
          )}
          {step === "calibration" && (
            <>
              <Paper
                guided
                onConnection={onSettings}
                status={status}
                onAction={onAction}
                visible={visible && step === "calibration"}
              />
              <div className="setup-calibration-finish">
                <label className="setup-check" title={!calibrationReady(profile) ? t("setup.calibrationRequired") : t("setup.confirmCalibration")}>
                  <input
                    type="checkbox"
                    checked={calibrationConfirmed}
                    disabled={!calibrationReady(profile)}
                    onChange={(event) =>
                      setCalibrationConfirmed(event.target.checked)
                    }
                  />
                  {t("setup.confirmCalibration")}
                </label>
                <div className="setup-actions">
                  <button
                    className="primary"
                    disabled={
                      !calibrationConfirmed || !calibrationReady(profile)
                    }
                    onClick={() => {
                      update((p) => ({
                        ...p,
                        calibrationFingerprint: profile.fingerprint,
                        finished: false,
                      }));
                      choose("drawing");
                    }}
                  >
                    {t("setup.continueDrawing")}
                  </button>
                  <button className="ghost" onClick={() => choose("drawing")}>
                    {t("setup.skipCalibration")}
                  </button>
                </div>
              </div>
            </>
          )}
          {step === "drawing" && (
            <SetupDrawingStep
              index={index}
              profile={profile}
              active={visible}
              onRefresh={() => refresh(true)}
              onDraw={() => onNavigate("paint")}
              onTemplates={() => onNavigate("games")}
              onNext={() => choose("preview")}
            />
          )}
          {step === "preview" && (
            <SetupPreviewStep
              index={index}
              profile={profile}
              active={visible}
              ready={ready}
              onReviewed={(pageId, modified, fingerprint) =>
                update((p) => ({
                  ...p,
                  preview: { pageId, modified, fingerprint },
                }))
              }
              onDraw={() => onNavigate("paint")}
              onFinish={() => {
                update((p) => ({ ...p, finished: true }));
                setExpanded(false);
              }}
            />
          )}
        </div>
      )}
      {!expanded && (
        <div className="setup-complete-actions">
          <button className="primary" onClick={() => onNavigate("paint")}>
            {t("start.openDrawing")}
          </button>
          {!ready && (
            <button
              onClick={() => choose(online ? "calibration" : "connection")}
            >
              {t("setup.finishMachineSetup")}
            </button>
          )}
          <p>{t("setup.firstPlotHint")}</p>
        </div>
      )}
    </section>
  );
}
