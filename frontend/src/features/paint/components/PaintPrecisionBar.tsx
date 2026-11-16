import { useId, useState } from "react";
import type { SceneObject } from "../../../api";
import CommittedNumberField from "../../../components/CommittedNumberField";
import { useI18n } from "../../../i18n";
import type { ObjectOps } from "../hooks/useObjectOps";
import { objectMeasurements } from "../lib/objectMeasurements";
import { sourcePageFrame } from "../lib/sourcePage";

/** Optional exact placement. Draft fields are scoped to the selected object. */
export default function PaintPrecisionBar({ objects, ops, sizeLinked, onSizeLinkedToggle, disabled = false, open: controlledOpen, showToggle = true }: {
  objects: SceneObject[];
  ops: Pick<ObjectOps, "setSelectedObjectPosition" | "setSelectedObjectSize" | "setSelectedObjectRotation">;
  sizeLinked: boolean; onSizeLinkedToggle: () => void; disabled?: boolean; open?: boolean; showToggle?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [storedOpen, setOpen] = useState(() => {
    try { return localStorage.getItem("paint-precision-open") === "1"; } catch { return false; }
  });
  const open = controlledOpen ?? storedOpen;
  const object = objects.length === 1 ? objects[0] : null;
  const size = object && objectMeasurements(object);
  const aspectLocked = !!object && !!sourcePageFrame(object);
  const changeOpen = () => setOpen(previous => {
    try { localStorage.setItem("paint-precision-open", previous ? "0" : "1"); } catch {}
    return !previous;
  });
  return <div className={`paint-precision-bar${open ? " open" : ""}`}>
    {showToggle && <button type="button" className="ghost precision-toggle" aria-expanded={open} aria-controls={id}
      onClick={changeOpen}><span aria-hidden="true">{open ? "▾" : "▸"}</span> {t("paint.measure.title")}</button>}
    <div id={id} className="precision-body" hidden={!open}>
      {open && <>
      {object && size ? <div className="precision-fields" key={object.id}>
        <CommittedNumberField decimalInput label="X" value={size.x} min={0} disabled={disabled}
          rejectionMessage={t("paint.measure.outside")} onChange={value => ops.setSelectedObjectPosition("x", value)} />
        <CommittedNumberField decimalInput label="Y" value={size.y} min={0} disabled={disabled}
          rejectionMessage={t("paint.measure.outside")} onChange={value => ops.setSelectedObjectPosition("y", value)} />
        <div className="precision-dimensions">
        <CommittedNumberField decimalInput label={t("common.width")} value={size.width} min={.1}
          disabled={disabled || size.localWidth <= 0} rejectionMessage={t("paint.measure.outside")}
          onChange={value => ops.setSelectedObjectSize("width", value)} />
        <button type="button" className={`size-link ${sizeLinked || aspectLocked ? "active" : ""}`}
          aria-pressed={sizeLinked || aspectLocked} aria-label={t("paint.keepAspect")} title={t("paint.keepAspect")}
          disabled={disabled || aspectLocked} onClick={onSizeLinkedToggle}>
          <svg className="size-link-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            {!sizeLinked && !aspectLocked && <path d="m3 3 18 18" />}
          </svg>
        </button>
        <CommittedNumberField decimalInput label={t("common.height")} value={size.height} min={.1}
          disabled={disabled || size.localHeight <= 0} rejectionMessage={t("paint.measure.outside")}
          onChange={value => ops.setSelectedObjectSize("height", value)} />
        </div>
        <CommittedNumberField decimalInput label={t("common.rotation")} unit="°" value={size.rotation} min={-360} max={360} step={1}
          disabled={disabled} rejectionMessage={t("paint.measure.outside")} onChange={ops.setSelectedObjectRotation} />
        <span className="precision-help" title={t("paint.measure.reference")} tabIndex={0}>ⓘ<span className="sr-only">{t("paint.measure.reference")}</span></span>
      </div> : <p className="muted precision-empty">{t("paint.measure.selectOne")}</p>}
      </>}
    </div>
  </div>;
}
