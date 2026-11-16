import SetupGuide from "./setup/SetupGuide";
import type { PrinterStatus } from "../../api/types/printer";
import { useI18n } from "../../i18n";
import type { WorkspaceId } from "../../interface/workspaces";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";

/** A single setup workspace; there is no second start screen with the same flow. */
export default function SetupWorkspace({
  status,
  onNavigate,
  onSettings,
  visible,
  onAction,
  onCalibrate,
}: {
  visible: boolean;
  onAction: () => void;
  onCalibrate: (profileId: string) => void;
  status: PrinterStatus | null;
  onNavigate: (workspace: WorkspaceId) => void;
  onSettings: () => void;
}) {
  const { t } = useI18n(),
    { index, profile, error, refresh } = useProjectCalibration();
  if (error)
    return (
      <div className="banner err" role="alert">
        {error}
        <button onClick={() => void refresh(true).catch(() => {})}>
          {t("common.reload")}
        </button>
      </div>
    );
  if (!index?.project || !profile)
    return <p role="status">{t("common.loading")}</p>;
  return (
    <SetupGuide
      key={`${index.project.id}:${profile.id}`}
      index={index}
      profile={profile}
      status={status}
      visible={visible}
      onSettings={onSettings}
      onNavigate={onNavigate}
      onAction={onAction}
      onCalibrate={onCalibrate}
    />
  );
}
