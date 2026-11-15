import type { PrinterStatus } from "../../api/types/printer";
import EditorIcon, { type EditorIconName } from "../../components/editor/EditorIcon";
import { useI18n } from "../../i18n";
import type { WorkspaceId } from "../../interface/workspaces";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";

/** Task-oriented landing workspace. Every action leads to an existing workflow. */
export default function StartOverview({ status, onNavigate, onSettings }: {
  status: PrinterStatus | null; onNavigate: (workspace: WorkspaceId) => void; onSettings: () => void;
}) {
  const { t } = useI18n();
  const { index, profile, loading, error, refresh } = useProjectCalibration();
  const drawing = index?.order.find(page => page.id === index.activeId);
  const steps = [
    { title: "start.profile", detail: profile ? profile.name : t("start.profileMissing"), done: !!profile, action: () => onNavigate("calibrate"), button: "start.chooseProfile" },
    { title: "start.connection", detail: t(status?.online ? "start.connected" : status?.configured ? "start.connectionOffline" : "start.connectionMissing"), done: !!status?.online, action: onSettings, button: "start.configureConnection" },
    { title: "start.calibration", detail: t(profile?.calibration.pen_calibrated ? "start.calibrationSaved" : "start.calibrationMissing"), done: !!profile?.calibration.pen_calibrated, action: () => onNavigate("paper"), button: "start.openCalibration" },
    { title: "start.drawing", detail: t(drawing?.objectCount ? "start.drawingExists" : "start.drawingMissing"), done: !!drawing?.objectCount, action: () => onNavigate("paint"), button: "start.openDrawing" },
  ];
  const actions: { icon: EditorIconName; title: string; detail: string; action: () => void }[] = [
    { icon: "draw", title: "start.draw", detail: "start.drawHint", action: () => onNavigate("paint") },
    { icon: "shape", title: "start.templates", detail: "start.templatesHint", action: () => onNavigate("games") },
    { icon: "image", title: "start.library", detail: "start.libraryHint", action: () => onNavigate("gallery") },
    { icon: "folder", title: "start.jobs", detail: "start.jobsHint", action: () => onNavigate("convert") },
  ];
  return <section className="start-workspace">
    <div className="workspace-heading"><div><h1>{t("start.title")}</h1><p>{t("start.intro")}</p></div>
      {index?.project && <span className="start-project">{t("start.currentProject")}: <strong>{index.project.name}</strong></span>}</div>
    {error && <div className="banner err" role="alert"><span>{error}</span><button onClick={() => { void refresh(true).catch(() => {}); }}>{t("save.retry")}</button></div>}
    <div className="start-layout">
      <section className="start-setup"><h2>{t("start.setupTitle")}</h2><p className="muted">{t("start.setupHint")}</p>
        <ol className="start-checklist">{steps.map((step, index) => <li key={step.title}>
          <span className={`setup-step-number${step.done ? " complete" : ""}`} aria-label={step.done ? t("start.available") : undefined}>{step.done ? <EditorIcon name="check" size={16} /> : index + 1}</span>
          <div><h3>{t(step.title)}</h3><p>{loading && index === 0 ? t("common.loading") : step.detail}</p></div>
          <button onClick={step.action}>{t(step.button)}</button>
        </li>)}</ol>
        <p className="start-safety-note">{t("start.safetyNote")}</p>
      </section>
      <aside className="start-actions"><h2>{t("start.createTitle")}</h2>
        {actions.map(action => <button key={action.title} onClick={action.action}><EditorIcon name={action.icon} size={21} />
          <span><strong>{t(action.title)}</strong><small>{t(action.detail)}</small></span></button>)}
      </aside>
    </div>
  </section>;
}
