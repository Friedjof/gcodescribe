import { useRef, useState } from "react";
import { executeCommand, useCommandShortcuts } from "../../hooks/useCommandShortcuts";
import { useI18n } from "../../i18n";
import FontEditor from "./components/FontEditor";
import FontLibrary from "./components/FontLibrary";

export default function FontWorkspace({ visible }: { visible: boolean }) {
  const { t } = useI18n();
  const [openedFont,setOpenedFont]=useState<string|null>(null);
  const [library, setLibrary] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const openEditor = (command: "open" | "newSlide") => {
    setLibrary(false); requestAnimationFrame(() => executeCommand(command));
  };
  useCommandShortcuts([
    { command: "open", input: true, run: () => openEditor("open") },
    { command: "newSlide", input: true, run: () => openEditor("newSlide") },
  ], visible && library, root);
  return <div ref={root} className="font-workspace">
    <nav className="font-workspace-tabs" aria-label={t("workspace.font")}>
      <button aria-pressed={!library} onClick={() => setLibrary(false)}>{t("fontWorkspace.editor")}</button>
      <button aria-pressed={library} onClick={() => setLibrary(true)}>{t("settings.fonts.library")}</button>
    </nav>
    <div className="font-workspace-content" hidden={library}><FontEditor visible={visible && !library} onDocumentChange={setOpenedFont}/></div>
    {library && <div className="font-library"><FontLibrary protectedFontId={openedFont}/></div>}
  </div>;
}
