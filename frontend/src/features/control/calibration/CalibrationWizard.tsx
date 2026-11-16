import GuidedCalibrationStep from "./GuidedCalibrationStep";
import { useI18n } from "../../../i18n";
import EditorMenu from "../../../components/editor/EditorMenu";
import SpecialPositions from "../SpecialPositions";
import HomeStep from "./HomeStep";
import PenStep from "./PenStep";
import CornersStep from "./CornersStep";
import ObstaclesStep from "./ObstaclesStep";
import ReviewStep from "./ReviewStep";
import type { CalibrationController } from "./useCalibrationController";
import type { CalibrationStep } from "./steps";

function StepContent({
  id,
  controls,
}: {
  id: CalibrationStep;
  controls: CalibrationController;
}) {
  const cal = controls.cal!;
  switch (id) {
    case "home":
      return <HomeStep cal={cal} controls={controls} />;
    case "pen":
      return <PenStep cal={cal} controls={controls} />;
    case "corners":
      return <CornersStep cal={cal} controls={controls} />;
    case "obstacles":
      return <ObstaclesStep controls={controls} />;
    case "apply":
      return <ReviewStep controls={controls} />;
    case "positions":
      return (
        <SpecialPositions
          cal={cal}
          pos={controls.pos}
          controls={controls.positions}
          onNext={controls.finishPositions}
          onOpenPressure={() => controls.setPressureOpen(true)}
        />
      );
  }
}

/** The same safe commands in a focused beginner flow or the full accordion. */
export default function CalibrationWizard({
  controls,
  guided,
}: {
  controls: CalibrationController;
  guided: boolean;
}) {
  const { t } = useI18n(),
    { steps, positions, busy, active, setActive, visible } = controls;
  const locked = positions.busy || busy;
  if (!guided)
    return (
      <div className="wizard">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={`wstep ${step.locked ? "locked" : ""} ${active === step.id ? "open" : ""}`}
          >
            <button
              className="wstep-head"
              disabled={step.locked || locked}
              aria-expanded={active === step.id}
              onClick={() => setActive(active === step.id ? null : step.id)}
            >
              <span className={`badge ${step.done ? "done" : ""}`}>
                {step.done
                  ? "✓"
                  : step.locked
                    ? "🔒"
                    : step.optional
                      ? "+"
                      : index + 1}
              </span>
              <span className="wstep-title">{t(step.titleKey)}</span>
              {step.optional && (
                <span className="calibration-optional">
                  {t("paper.optional")}
                </span>
              )}
            </button>
            {active === step.id && !step.locked && (
              <div className="wstep-body">
                <StepContent id={step.id} controls={controls} />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  const required = steps.filter((step) => !step.optional),
    current = steps.find((step) => step.id === active) ?? required[0];
  return (
    <div className="calibration-focused">
      <nav className="calibration-step-tabs" aria-label={t("paper.title")}>
        {required.map((step, index) => (
          <button
            type="button"
            key={step.id}
            disabled={locked || step.locked}
            aria-current={current.id === step.id ? "step" : undefined}
            onClick={() => setActive(step.id)}
          >
            <span>{step.done ? "✓" : index + 1}</span>
            {t(`paper.nav.${step.id}`)}
          </button>
        ))}
      </nav>
      <section className="calibration-current-step">
        <h3>{t(current.titleKey)}</h3>
        {!current.locked && <GuidedCalibrationStep key={current.id} id={current.id} controls={controls} />}
      </section>
      <div className="calibration-optional-tools">
        <EditorMenu
          label={t("paper.optionalTools")}
          active={visible && !locked}
          items={steps
            .filter((step) => step.optional)
            .map((step) => ({
              id: step.id,
              label: t(step.titleKey),
              disabled: step.locked || locked,
              action: () => setActive(step.id),
            }))}
        />
        <span>{t("paper.optionalToolsHint")}</span>
      </div>
    </div>
  );
}
