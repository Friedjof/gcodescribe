import { useState } from "react";
import { useI18n } from "../../i18n";

export default function FontEditorHeader({
  hasCurrent,
  currentLabel,
  dirty,
  busy,
  onCreate,
  onOpenList,
}: {
  hasCurrent: boolean;
  currentLabel: string | null;
  dirty: boolean;
  busy: boolean;
  onCreate: (label: string) => void;
  onOpenList: () => void;
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
          <span className={`fe-dirty-badge ${dirty ? "is-dirty" : "is-saved"}`}>
            {dirty ? t("fontEditor.unsaved") : t("fontEditor.saved")}
          </span>
        </div>
      )}
    </header>
  );
}
