import Modal from "../../../components/Modal";
import { useI18n } from "../../../i18n";

export default function PenInsertionDialog({step,error,canMove,onConfirm,onClose}:{
  step:"confirm"|"moving"|"insert";error:string;canMove:boolean;onConfirm:()=>void;onClose:()=>void;
}) {
  const {t}=useI18n();
  return <Modal title={t("penInsert.title")} onClose={()=>{if(step!=="moving")onClose();}} className="pen-insertion-modal"
    footer={<>{step!=="moving" && <button onClick={onClose}>{t(step==="insert"?"penInsert.done":"common.cancel")}</button>}
      {step==="confirm" && <button className="primary" disabled={!canMove} onClick={onConfirm}>{t("penInsert.go")}</button>}</>}>
    {error && <p role="alert">{error}</p>}
    <p>{t(`penInsert.${step}`)}</p>
    {step==="insert" && <svg viewBox="0 0 260 160" width="260" height="160" role="img" aria-label={t("penInsert.sketch")}>
      <path d="M25 140H235" stroke="currentColor" strokeWidth="4"/>
      <rect x="100" y="50" width="60" height="38" rx="3" fill="none" stroke="var(--accent)" strokeWidth="3"/>
      <path d="M122 15H138V117L130 139L122 117Z" fill="var(--paper)" stroke="currentColor" strokeWidth="2"/>
      <path d="M180 103V132M174 124L180 132L186 124" fill="none" stroke="var(--accent)" strokeWidth="3"/>
    </svg>}
  </Modal>;
}
