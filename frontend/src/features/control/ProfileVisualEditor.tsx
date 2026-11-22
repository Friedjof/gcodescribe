import type { PrinterStatus } from "../../api";
import { useI18n } from "../../i18n";
import Paper from "./Paper";

export default function ProfileVisualEditor({
  profileId,
  archived,
  visible,
  status,
  onAction,
  onSettings,
  onBusyChange,
}: {
  profileId: string;
  archived: boolean;
  visible: boolean;
  status: PrinterStatus | null;
  onAction: () => void;
  onSettings: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="profile-visual-editor">
      {(archived || !status?.online) && (
        <div className="profile-visual-notice">
          <span>
            {t(
              archived
                ? "profiles.visualArchived"
                : "paper.offline",
            )}
          </span>
          <div>
            {!status?.online && (
              <button onClick={onSettings}>
                {t("start.configureConnection")}
              </button>
            )}
          </div>
        </div>
      )}
      <Paper
        key={profileId}
        guided
        profileId={profileId}
        status={status}
        onAction={onAction}
        onConnection={onSettings}
        visible={visible}
        onBusyChange={onBusyChange}
      />
    </div>
  );
}
