import PaginationBar from "../../../components/paging/PaginationBar";
import { useFitListPage } from "../../../components/paging/useFitListPage";
import { useI18n } from "../../../i18n";
import Modal from "../../../components/Modal";
import type { StrokeFontSummary } from "../../../api";

export default function FontListDialog({
  fonts,
  onOpen,
  onDelete,
  onClose,
}: {
  fonts: StrokeFontSummary[];
  onOpen: (id: string) => boolean | void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const paging = useFitListPage(fonts, 65, 5);
  return (
    <Modal title={t("fontEditor.listTitle")} onClose={onClose} className="fe-list-modal">
      <div className="fe-font-list-viewport" ref={paging.viewport}>
      {fonts.length === 0 ? (
        <p className="muted">{t("fontEditor.listEmpty")}</p>
      ) : (
        <ul className="fe-font-list">
          {paging.items.map((font) => (
            <li key={font.id} className="fe-font-list-item">
              <button
                className="fe-font-open"
                onClick={() => {
                  if (onOpen(font.id) !== false) onClose();
                }}
              >
                <span className="fe-font-name">{font.label}</span>
                <span className="muted">
                  {t("fontEditor.glyphCountLabel", { n: font.glyphCount })}
                </span>
              </button>
              <button
                className="ghost danger"
                onClick={() => onDelete(font.id)}
                title={t("fontEditor.deleteFont")}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
      <PaginationBar page={paging.page} pages={paging.pages} onChange={paging.setPage} label={t("fontEditor.listTitle")}/>
    </Modal>
  );
}
