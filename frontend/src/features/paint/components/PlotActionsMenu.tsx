import EditorMenu from "../../../components/editor/EditorMenu";
import { useI18n } from "../../../i18n";

/** Explicit plot action plus related commands in the shared, viewport-safe menu. */
export default function PlotActionsMenu({
  busy,
  sending,
  printerBusy,
  printerOnline,
  emphasis = true,
  visible = true,
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
  printerOnline: boolean;
  emphasis?: boolean;
  visible?: boolean;
  pageBlocked: boolean;
  hasSelection: boolean;
  hasObjects: boolean;
  onDirectPlot: () => void;
  onPlotSelection: () => void;
  onOpenColoring: () => void;
}) {
  const { t } = useI18n();
  const disabled = busy || sending || printerBusy || pageBlocked,
    plotDisabled = disabled || !printerOnline;
  return (
    <div className="split-button">
      <button
        type="button"
        className={`${emphasis ? "primary " : ""}split-main`}
        disabled={plotDisabled || !hasObjects}
        title={
          !printerOnline
            ? t("paint.printerUnavailable")
            : pageBlocked
              ? t("paint.gcodeBlocked")
              : ""
        }
        onClick={onDirectPlot}
      >
        {t(
          busy
            ? "paint.generating"
            : sending
              ? "paint.starting"
              : "paint.directPlot",
        )}
      </button>
      <EditorMenu
        label={t("paint.plotOptions")}
        active={visible && !disabled}
        className={`${emphasis ? "primary " : ""}split-toggle`}
        items={[
          {
            id: "selection",
            label: t("paint.plotSelection"),
            disabled: plotDisabled || !hasSelection,
            icon: "select",
            action: onPlotSelection,
          },
          {
            id: "coloring",
            label: t("paint.coloring"),
            disabled: disabled || !hasObjects,
            icon: "bucket",
            action: onOpenColoring,
          },
        ]}
      >
        <span className="sr-only">{t("paint.plotOptions")}</span>
      </EditorMenu>
    </div>
  );
}
