import { useI18n } from "../../i18n";
import Modal from "../Modal";

export default function DiscardGlyphDialog({
  onCancel,
  onDiscard,
  onSaveAndContinue,
  canSave,
}: {
  onCancel: () => void;
  onDiscard: () => void;
  onSaveAndContinue: () => void;
  canSave: boolean;
}) {
  const { t } = useI18n();
  return (
    <Modal
      title={t("fontEditor.discardGlyphTitle")}
      onClose={onCancel}
      className="fe-discard-modal"
      footer={
        <>
          <button onClick={onCancel}>{t("fontEditor.keepEditing")}</button>
          <button className="primary" onClick={onSaveAndContinue} disabled={!canSave}>
            {t("fontEditor.saveAndContinue")}
          </button>
          <button className="primary danger" onClick={onDiscard}>
            {t("fontEditor.discardChanges")}
          </button>
        </>
      }
    >
      <p className="fe-discard-message">{t("fontEditor.discardGlyphConfirm")}</p>
    </Modal>
  );
}
