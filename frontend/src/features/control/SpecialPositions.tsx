import type { Calibration, Position } from "../../api";
import Segmented from "../../components/Segmented";
import { useI18n } from "../../i18n";
import { positionDefinition, savedPosition, SPECIAL_POSITIONS } from "./specialPositions";
import type { useSpecialPositions } from "./useSpecialPositions";

export default function SpecialPositions({ cal, pos, controls, onNext, onOpenPressure }: {
  cal: Calibration;
  pos: Position | null;
  controls: ReturnType<typeof useSpecialPositions>;
  onNext: () => void;
  onOpenPressure: () => void;
}) {
  const { t } = useI18n();
  const point = positionDefinition(controls.kind);
  const saved = savedPosition(cal, controls.kind);
  const disabled = !controls.ready || controls.busy;
  const coords = (xy: { x: number; y: number } | null) => xy
    ? <><span>X {xy.x.toFixed(1)}</span><span>Y {xy.y.toFixed(1)} <small>mm</small></span></>
    : "—";
  return (
    <div className="special-positions" aria-busy={controls.busy}>
      <fieldset disabled={controls.busy} className="position-selector">
        <legend className="sr-only">{t("paper.positions.select")}</legend>
        <Segmented value={controls.kind} onChange={controls.select} options={SPECIAL_POSITIONS.map((item) => ({
          value: item.kind,
          label: t(item.label),
        }))} />
      </fieldset>
      <p className="muted">{t(point.hint)}</p>
      <p className="calibration-task-note">{t("paper.positions.defaultsHint")}</p>
      <dl className="position-coordinates">
        <div><dt>{t("paper.positions.stored")}</dt><dd>{coords(saved)}</dd></div>
        <div><dt>{t("paper.positions.head")}</dt><dd>{coords(pos?.homed ? pos : null)}</dd></div>
        <div className="position-target"><dt>{t("paper.positions.target")}</dt><dd>{coords(controls.target)}</dd></div>
      </dl>
      <p className="position-instruction" role="status">
        {controls.busy ? t("common.loading") : controls.message || t("paper.positions.instructions", { marker: t(point.label) })}
      </p>
      <div className="position-actions">
        <button disabled={!controls.available || controls.busy} onClick={controls.homeAndVisit}
          title={t("paper.positions.homeHint", { marker: t(point.label) })}>
          {t("paper.positions.homeVisit", { marker: t(point.label) })}
        </button>
        <button disabled={disabled} onClick={controls.capture}>{t("paper.positions.capture", { marker: t(point.label) })}</button>
        {controls.kind === "calibration" && cal.pen_calibrated && <button className="ghost position-pressure" disabled={controls.busy}
          aria-label={t("paper.pressure.title")}
          title={`${t("paper.pressure.title")} · ${(cal.calibration_pressure_offset ?? 0) > 0 ? "+" : ""}${cal.calibration_pressure_offset ?? 0} mm`}
          onClick={onOpenPressure}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 3v18M17 3v18M4 7h6M14 16h6" />
            <circle cx="7" cy="7" r="2" fill="var(--panel)" />
            <circle cx="17" cy="16" r="2" fill="var(--panel)" />
          </svg>
        </button>}
        <button className="primary" disabled={!controls.available || controls.busy || !pos?.homed} onClick={onNext}>
          {t("paper.preparePen")} →
        </button>
      </div>
      {!controls.ready && <p className="muted">{t("paper.positions.unavailable")}</p>}
    </div>
  );
}
