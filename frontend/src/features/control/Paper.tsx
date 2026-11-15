import { useI18n } from "../../i18n";
import SpecialPositions from "./SpecialPositions";
import CalibrationPressureDialog from "./CalibrationPressureDialog";
import { useCalibrationController, type CalibrationControllerProps } from "./calibration/useCalibrationController";
import HomeStep from "./calibration/HomeStep";
import PenStep from "./calibration/PenStep";
import CornersStep from "./calibration/CornersStep";
import ObstaclesStep from "./calibration/ObstaclesStep";
import ReviewStep from "./calibration/ReviewStep";
import CalibrationPreview from "./calibration/CalibrationPreview";

export default function Paper(props: CalibrationControllerProps) {
  const { t } = useI18n();
  const controls = useCalibrationController(props);
  const { cal, error, retry, visible, pressureOpen, online, motionLocked, positions,
    projectId, profileId, setPressureOpen, setPressureBusy, setPos, profileName, project,
    steps, busy, active, setActive, pos, finishPositions } = controls;
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

        <div className="wizard">
          {steps.map((s, index) => (
            <div key={s.id} className={`wstep ${s.locked ? "locked" : ""} ${active === s.id ? "open" : ""}`}>
              <button
                className="wstep-head"
                disabled={s.locked || positions.busy || busy}
                aria-expanded={active === s.id}
                onClick={() => setActive(active === s.id ? null : s.id)}
              >
                <span className={`badge ${s.done ? "done" : ""}`}>
                  {s.done ? "✓" : s.locked ? "🔒" : s.optional ? "+" : index + 1}
                </span>
                <span className="wstep-title">{t(s.titleKey)}</span>
                {s.optional && <span className="calibration-optional">{t("paper.optional")}</span>}
              </button>

              {active === s.id && !s.locked && (
                <div className="wstep-body">

                  {s.id === "home" && <HomeStep cal={cal} controls={controls} />}
                  {s.id === "pen" && <PenStep cal={cal} controls={controls} />}
                  {s.id === "corners" && <CornersStep cal={cal} controls={controls} />}
                  {s.id === "obstacles" && <ObstaclesStep controls={controls} />}
                  {s.id === "apply" && <ReviewStep controls={controls} />}
                  {s.id === "positions" && <SpecialPositions cal={cal} pos={pos} controls={positions}
                    onNext={finishPositions} onOpenPressure={() => setPressureOpen(true)} />}

                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      {/* ── Right: Live View ─────────────────────────────────────── */}
      <CalibrationPreview cal={cal} controls={controls} />

    </div>
  );
}
