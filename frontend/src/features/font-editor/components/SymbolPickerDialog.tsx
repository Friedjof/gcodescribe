import { useState } from "react";
import PagedGrid from "../../../components/paging/PagedGrid";
import { useI18n } from "../../../i18n";
import Modal from "../../../components/Modal";
import { SYMBOL_GROUPS } from "../lib/constants";

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
  const [groupId, setGroupId] = useState(SYMBOL_GROUPS[0].id);
  const group = SYMBOL_GROUPS.find((item) => item.id === groupId) ?? SYMBOL_GROUPS[0];

  return (
    <Modal
      title={t("fontEditor.symbolsTitle")}
      onClose={onClose}
      className="fe-symbols-modal"
      bodyClassName="fe-symbols-modal-body"
    >
      <div className="fe-symbols">
        <select aria-label={t("fontEditor.symbolsTitle")} value={groupId} onChange={(e) => setGroupId(e.target.value)}>{SYMBOL_GROUPS.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)}</option>)}</select>
        <PagedGrid minWidth={44} footerHeight={10} label={t("fontEditor.symbolsTitle")} resetKey={groupId} items={group.keys} itemKey={(key) => key} renderItem={(key) => <button className={`fe-symbol-cell ${capturedKeys.has(key) ? "is-captured" : ""}`} title={t(capturedKeys.has(key) ? "fontEditor.captured" : "fontEditor.missing")} onClick={() => { onPick(key); onClose(); }}>{key}</button>}/>

      </div>
    </Modal>
  );
}
