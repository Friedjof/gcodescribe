import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n";

/** Direct-plot split button with its dropdown (plot selection / coloring).
 * Owns the open state and the outside-click/Escape dismissal. */
export default function PlotActionsMenu({
  busy,
  sending,
  printerBusy,
  pageBlocked,
  hasSelection,
  hasObjects,
  onDirectPlot,
  onPlotSelection,
  onOpenColoring,
}: {
  busy: boolean;
  sending: boolean;
  printerBusy: boolean;
  pageBlocked: boolean;
  hasSelection: boolean;
  hasObjects: boolean;
  onDirectPlot: () => void;
  onPlotSelection: () => void;
  onOpenColoring: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const disabled = busy || sending || printerBusy || pageBlocked;
  return (
    <div className="split-button" ref={menuRef}>
      <button
        className="primary split-main"
        disabled={disabled}
        title={pageBlocked ? t("paint.gcodeBlocked") : ""}
        onClick={onDirectPlot}
      >
        {busy ? t("paint.generating") : sending ? t("paint.starting") : t("paint.directPlot")}
      </button>
      <button
        className="primary split-toggle"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("paint.plotSelection")}
        onClick={() => setOpen((v) => !v)}
      >
        ▾
      </button>
      {open && (
        <div className="split-menu" role="menu">
          <button
            role="menuitem"
            disabled={disabled || !hasSelection}
            title={!hasSelection ? t("paint.noSelection") : pageBlocked ? t("paint.gcodeBlocked") : t("paint.plotSelectionHint")}
            onClick={() => { setOpen(false); onPlotSelection(); }}
          >
            {t("paint.plotSelection")}
          </button>
          <button
            role="menuitem"
            disabled={disabled || !hasObjects}
            title={!hasObjects ? t("paint.emptyHint") : pageBlocked ? t("paint.gcodeBlocked") : t("paint.coloringHint")}
            onClick={() => { setOpen(false); onOpenColoring(); }}
          >
            {t("paint.coloring")}
          </button>
        </div>
      )}
    </div>
  );
}
