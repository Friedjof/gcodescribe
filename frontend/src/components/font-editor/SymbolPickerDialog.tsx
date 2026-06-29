import { useI18n } from "../../i18n";
import Modal from "../Modal";
import { SYMBOL_GROUPS } from "../../fontEditor/constants";

export default function SymbolPickerDialog({
  capturedKeys,
  onPick,
  onClose,
}: {
  capturedKeys: Set<string>;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal title={t("fontEditor.symbolsTitle")} onClose={onClose} className="fe-symbols-modal">
      <div className="fe-symbols">
        {SYMBOL_GROUPS.map((group) => (
          <section key={group.id} className="fe-symbol-group">
            <h4 className="fe-symbol-group-title">{t(group.labelKey)}</h4>
            <div className="fe-symbol-grid">
              {group.keys.map((key) => (
                <button
                  key={key}
                  className={`fe-symbol-cell ${capturedKeys.has(key) ? "is-captured" : ""}`}
                  title={capturedKeys.has(key) ? t("fontEditor.captured") : t("fontEditor.missing")}
                  onClick={() => {
                    onPick(key);
                    onClose();
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
