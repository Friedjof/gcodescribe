import { useI18n } from "../../i18n";
import type { WorkspaceId } from "../../interface/workspaces";
import EditorMenu from "./EditorMenu";
import InterfaceMenu from "./InterfaceMenu";
export default function ProgramMenus({
  onNavigate,
  onProjects,
  onNewPage,
  onSettings,
  onCustomize,
  onHelp,
  aiEnabled,
  notifications,
}: {
  onNavigate: (id: WorkspaceId) => void;
  onProjects: () => void;
  onNewPage: () => void;
  onSettings: () => void;
  onCustomize: () => void;
  onHelp: () => void;
  aiEnabled: boolean;
  notifications: { supported: boolean; granted: boolean; action: () => void };
}) {
  const { t } = useI18n();
  const extra = (id: WorkspaceId) => () => onNavigate(id);
  return (
    <>
      <EditorMenu
        label={t("app.file")}
        className="program-menu"
        items={[
          {
            id: "new",
            label: t("app.newPage"),
            icon: "add",
            action: onNewPage,
          },
          {
            id: "projects",
            label: t("app.projects"),
            icon: "folder",
            action: onProjects,
          },
          {
            id: "jobs",
            label: t("workspace.convert"),
            icon: "pages",
            separator: true,
            action: extra("convert"),
          },
        ]}
      />
      <InterfaceMenu onCustomize={onCustomize} />
      <EditorMenu
        label={t("app.tools")}
        className="program-menu"
        items={[
          {
            id: "profiles",
            label: t("workspace.calibrate"),
            icon: "settings",
            action: extra("calibrate"),
          },
          {
            id: "control",
            label: t("workspace.control"),
            icon: "plug",
            action: extra("control"),
          },
          {
            id: "fonts",
            label: t("workspace.font"),
            icon: "text",
            action: extra("font"),
          },
          ...(aiEnabled
            ? [
                {
                  id: "ai",
                  label: t("workspace.ai"),
                  icon: "image" as const,
                  action: extra("ai"),
                },
              ]
            : []),
          {
            id: "settings",
            label: t("settings.title"),
            icon: "settings",
            separator: true,
            action: onSettings,
          },
          {
            id: "notify",
            label: t(notifications.granted ? "notify.test" : "notify.enable"),
            icon: "bell",
            disabled: !notifications.supported,
            action: notifications.action,
          },
        ]}
      />
      <EditorMenu
        label={t("app.help")}
        className="program-menu"
        items={[
          {
            id: "setup",
            label: t("workspace.paper"),
            icon: "measure",
            action: extra("paper"),
          },
          {
            id: "keys",
            label: t("paint.info.button"),
            icon: "help",
            action: onHelp,
          },
        ]}
      />
    </>
  );
}
