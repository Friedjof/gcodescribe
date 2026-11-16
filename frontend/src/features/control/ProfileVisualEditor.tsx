import type { PrinterStatus } from "../../api";
import { useI18n } from "../../i18n";
import Paper from "./Paper";

export default function ProfileVisualEditor({
  profileId,
  active,
  archived,
  visible,
  status,
  onAction,
  onSettings,
  onActivate,
  onBusyChange,
}: {
  profileId: string;
  active: boolean;
  archived: boolean;
  visible: boolean;
  status: PrinterStatus | null;
  onAction: () => void;
  onSettings: () => void;
  onActivate: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="profile-visual-editor">
      {(!active || !status?.online) && (
        <div className="profile-visual-notice">
          <span>
            {t(
              archived
                ? "profiles.visualArchived"
                : !active
                  ? "profiles.visualInactive"
                  : "paper.offline",
            )}
          </span>
          <div>
            {!active && !archived && (
              <button onClick={onActivate}>{t("profiles.activate")}</button>
            )}
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
