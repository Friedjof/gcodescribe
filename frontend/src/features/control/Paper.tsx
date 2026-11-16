import { useI18n } from "../../i18n";
import CalibrationPressureDialog from "./CalibrationPressureDialog";
import { useCalibrationController, type CalibrationControllerProps } from "./calibration/useCalibrationController";
import CalibrationWizard from "./calibration/CalibrationWizard";
import CalibrationPreview from "./calibration/CalibrationPreview";

export default function Paper(props: CalibrationControllerProps & { guided?: boolean }) {
  const { t } = useI18n();
  const controls = useCalibrationController(props);
  const { cal, error, retry, visible, pressureOpen, online, motionLocked, positions,
    projectId, profileId, setPressureOpen, setPressureBusy, setPos, profileName, project,
    pos } = controls;
  if (error) return <div className="card banner err" role="alert"><p>{error}</p>
    <button onClick={retry}>Erneut laden</button></div>;
  if (!cal) return <div className="card">{t("common.loading")}</div>;
  return (
    <div className="grid paper-grid">
      {visible && pressureOpen && <CalibrationPressureDialog canMove={!!online && !motionLocked && !positions.busy}
        projectId={projectId} profileId={profileId ?? undefined}
        onClose={() => setPressureOpen(false)} onBusyChange={setPressureBusy}
        position={pos} onPosition={setPos} onAction={props.onAction} />}
      {/* ── Left: Wizard ────────────────────────────────────────── */}
      <section className="card paper-wizard-panel">
        <h2>{t("paper.title")}</h2>
        <p className="calibration-intro">{t("paper.guideIntro")}</p>
        {profileName && (
          <p className="calibration-context">{t("paper.context", { project: project?.name ?? "", profile: profileName })}</p>
        )}
        {!online && (
          <div className="banner err" style={{ marginBottom: 14 }}>
            {t("paper.offline")}
          </div>
        )}

        <CalibrationWizard controls={controls} guided={props.guided ?? false} />
      </section>
      {/* ── Right: Live View ─────────────────────────────────────── */}
      <CalibrationPreview cal={cal} controls={controls} />

    </div>
  );
}
