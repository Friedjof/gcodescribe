import SetupGuide from "./setup/SetupGuide";
import type { PrinterStatus } from "../../api/types/printer";
import EditorIcon, {
  type EditorIconName,
} from "../../components/editor/EditorIcon";
import { useI18n } from "../../i18n";
import type { WorkspaceId } from "../../interface/workspaces";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";

/** Task-oriented landing workspace. Every action leads to an existing workflow. */
export default function StartOverview({
  status,
  onNavigate,
  onSettings,
  visible,
  onAction,
  setupOnly = false,
}: {
  setupOnly?: boolean;
  visible: boolean;
  onAction: () => void;
  status: PrinterStatus | null;
  onNavigate: (workspace: WorkspaceId) => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const { index, profile, loading, error, refresh } = useProjectCalibration();
  const actions: {
    icon: EditorIconName;
    title: string;
    detail: string;
    action: () => void;
  }[] = [
    {
      icon: "draw",
      title: "start.draw",
      detail: "start.drawHint",
      action: () => onNavigate("paint"),
    },
    {
      icon: "shape",
      title: "start.templates",
      detail: "start.templatesHint",
      action: () => onNavigate("games"),
    },
    {
      icon: "image",
      title: "start.library",
      detail: "start.libraryHint",
      action: () => onNavigate("gallery"),
    },
    {
      icon: "folder",
      title: "start.jobs",
      detail: "start.jobsHint",
      action: () => onNavigate("convert"),
    },
  ];
  return (
    <section className="start-workspace">
      <div className="workspace-heading">
        <div>
          <h1>{t(setupOnly ? "workspace.paper" : "start.title")}</h1>
          <p>{t("start.intro")}</p>
        </div>
        {index?.project && (
          <span className="start-project">
            {t("start.currentProject")}: <strong>{index.project.name}</strong>
          </span>
        )}
      </div>
      {error && (
        <div className="banner err" role="alert">
          <span>{error}</span>
          <button
            onClick={() => {
              void refresh(true).catch(() => {});
            }}
          >
            {t("save.retry")}
          </button>
        </div>
      )}
      {index?.project && profile && (
        <SetupGuide
          key={`${index.project.id}:${profile.id}`}
          index={index}
          profile={profile}
          status={status}
          visible={visible}
          onSettings={onSettings}
          onNavigate={onNavigate}
          onAction={onAction}
        />
      )}
      {loading && !profile && <p role="status">{t("common.loading")}</p>}
      {!setupOnly && (
        <div className="start-quick-actions">
          <aside className="start-actions">
            <h2>{t("start.createTitle")}</h2>
            {actions.map((action) => (
              <button key={action.title} onClick={action.action}>
                <EditorIcon name={action.icon} size={21} />
                <span>
                  <strong>{t(action.title)}</strong>
                  <small>{t(action.detail)}</small>
                </span>
              </button>
            ))}
          </aside>
        </div>
      )}
    </section>
  );
}
