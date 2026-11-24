import { useState } from "react";
import { useI18n } from "../../../i18n";

export default function FontEditorHeader({
  hasCurrent,
  currentLabel,
  dirty,
  busy,
  onCreate,
  onOpenList,
  onCloseCurrent,
  onRename,
  onExport,
}: {
  hasCurrent: boolean;
  currentLabel: string | null;
  dirty: boolean;
  busy: boolean;
  onCreate: (label: string) => void;
  onOpenList: () => void;
  onCloseCurrent?:()=>void;
  onRename?: () => void;
  onExport?: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");

  const submit = () => {
    const label = name.trim();
    if (!label) return;
    onCreate(label);
    setName("");
  };

  return (
    <header className="fe-header">
      <div className="fe-header-create">
        <input
          className="fe-name-input"
          value={name}
          placeholder={t("fontEditor.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={busy}
        />
        <button className="primary" onClick={submit} disabled={busy || !name.trim()}>
          {t("fontEditor.create")}
        </button>
        <button className="ghost" onClick={onOpenList} disabled={busy}>
          {t("fontEditor.myFonts")}
        </button>
      </div>

      {hasCurrent && (
        <div className="fe-header-current">
          <span className="fe-current-label">{currentLabel}</span>
          <button className="ghost" disabled={busy} onClick={onRename} title="F2">{t("profiles.renameAction")}</button>
          <button className="ghost" disabled={busy} onClick={onExport} title="Ctrl+Shift+E">{t("settings.fonts.export")}</button>
          {onCloseCurrent && <button className="ghost" disabled={busy} onClick={onCloseCurrent}>{t("fontWorkspace.close")}</button>}
          <span className={`fe-dirty-badge ${dirty ? "is-dirty" : "is-saved"}`}>
            {dirty ? t("fontEditor.unsaved") : t("fontEditor.saved")}
          </span>
        </div>
      )}
    </header>
  );
}
