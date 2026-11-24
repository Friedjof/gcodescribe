import { useAppTour } from "../../features/tour/TourProvider";
import { useI18n } from "../../i18n";
import type { WorkspaceId } from "../../interface/workspaces";
import EditorMenu from "./EditorMenu";
import InterfaceMenu from "./InterfaceMenu";
import { shortcutLabels } from "../../interface/shortcuts";
import { commandAvailable, executeCommand } from "../../hooks/useCommandShortcuts";
export default function ProgramMenus({
  onNavigate,
  onProjects,
  onNewPage,
  onCustomize,
  onHelp,
  onSettings,
  aiEnabled,
  notifications,
  workspace = "paint",
}: {
  onNavigate: (id: WorkspaceId) => void;
  onProjects: () => void;
  onNewPage: () => void;
  onCustomize: () => void;
  onHelp: () => void;
  onSettings?: () => void;
  aiEnabled: boolean;
  workspace?: WorkspaceId;
  notifications: { supported: boolean; granted: boolean; action: () => void };
}) {
  const { t } = useI18n();
  const tour = useAppTour();
  const extra = (id: WorkspaceId) => () => onNavigate(id);
  return (
    <>
      <EditorMenu
        label={t("app.file")}
        className="program-menu"
        items={[
          {
            id: "new",
            label: t(workspace === "font" ? "fontEditor.create" : "app.newPage"),
            icon: "add",
            action: () => { if (!executeCommand("newSlide")) onNewPage(); },
            shortcut: shortcutLabels.newSlide,
          },
          {
            id: "projects",
            label: t(workspace === "font" ? "fontEditor.myFonts" : "app.projects"),
            icon: "folder",
            action: () => { if (!executeCommand("open")) onProjects(); },
            shortcut: shortcutLabels.open,
          },
          {
            id: "new-project", label: t("projects.newProject"), shortcut: shortcutLabels.newProject,
            icon: "folder", action: () => executeCommand("newProject"),
          },
          {
            id: "save", label: t("shortcuts.save"), shortcut: shortcutLabels.save, icon: "check",
            disabled: () => !commandAvailable("save"), action: () => executeCommand("save"),
          },
          {
            id: "export-document", label: t("shortcuts.export"), shortcut: shortcutLabels.export, icon: "folder",
            disabled: () => !commandAvailable("export"), action: () => executeCommand("export"),
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
      <InterfaceMenu onCustomize={onCustomize} editable={workspace === "paint" || workspace === "font"} />
      <EditorMenu
        label={t("app.tools")}
        className="program-menu"
        items={[
          {
            id: "settings",
            label: t("settings.title"),
            icon: "settings",
            shortcut: shortcutLabels.settings,
            action: () => onSettings?.(),
          },
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
            id: "tour",
            label: t("tour.menu"),
            icon: "help",
            action: () => tour?.offer(),
          },
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
            shortcut: shortcutLabels.shortcuts,
          },
        ]}
      />

    </>
  );
}
