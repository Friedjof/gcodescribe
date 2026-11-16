import { useEffect } from "react";
import { useI18n } from "../../i18n";
import CalibrationPressureDialog from "./CalibrationPressureDialog";
import { useCalibrationController, type CalibrationControllerProps } from "./calibration/useCalibrationController";
import CalibrationWizard from "./calibration/CalibrationWizard";
import CalibrationPreview from "./calibration/CalibrationPreview";

export default function Paper(props: CalibrationControllerProps & { guided?: boolean; onConnection?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const { t } = useI18n();
  const controls = useCalibrationController(props);
  const { cal, error, retry, visible, pressureOpen, online, motionLocked, positions,
    projectId, profileId, setPressureOpen, setPressureBusy, setPos, profileName, project,
    pos } = controls;
  useEffect(() => { props.onBusyChange?.(controls.busy || positions.busy || controls.pressureBusy); return () => props.onBusyChange?.(false); }, [controls.busy, positions.busy, controls.pressureBusy, props.onBusyChange]);
  if (error) return <div className="card banner err" role="alert"><p>{error}</p>
    <button onClick={retry}>Erneut laden</button></div>;
  if (!cal) return <div className="card">{t("common.loading")}</div>;
  return (
    <>
      {controls.readOnly && <div className="profile-compat-notice" role="status"><span>{t("profiles.previewOnly")}</span><button onClick={retry}>{t("common.reload")}</button></div>}
    <div className={`grid paper-grid${props.guided ? " paper-guided" : ""}`}>
      {visible && pressureOpen && <CalibrationPressureDialog canMove={!!online && !motionLocked && !positions.busy}
        projectId={projectId} profileId={profileId ?? undefined}
        onClose={() => setPressureOpen(false)} onBusyChange={setPressureBusy}
        position={pos} onPosition={setPos} onAction={props.onAction} />}
      {/* ── Left: Wizard ────────────────────────────────────────── */}
      <section className="card paper-wizard-panel">
        {!props.guided && <><h2>{t("paper.title")}</h2>
        <p className="calibration-intro">{t("paper.guideIntro")}</p>
        {profileName && (
          <p className="calibration-context">{t("paper.context", { project: project?.name ?? "", profile: profileName })}</p>
        )}
        {!online && (
          <div className="banner err" style={{ marginBottom: 14 }}>
            {t("paper.offline")}
          </div>
        )}

        </>}
        {props.guided && !props.profileId && <div className="paper-connection-strip"><span title={profileName ?? undefined}>{profileName}</span>{!online && <button onClick={props.onConnection}>{t("start.configureConnection")}</button>}</div>}
        <CalibrationWizard controls={controls} guided={props.guided ?? false} />
      </section>
      {/* ── Right: Live View ─────────────────────────────────────── */}
      <CalibrationPreview cal={cal} controls={controls} compact={props.guided} />

    </div>
    </>
  );
}
