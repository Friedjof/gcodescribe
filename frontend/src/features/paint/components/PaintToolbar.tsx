import type { Page } from "../../../api";
import Segmented from "../../../components/Segmented";
import LiveButton from "../../stream/components/LiveButton";
import type { StreamState } from "../../stream/lib/protocol";
import { useI18n } from "../../../i18n";
import PlotActionsMenu from "./PlotActionsMenu";

const GRID_STEPS = [1, 5, 10, 25, 50];

/** Editor top bar: page title, grid/snap/slice controls and the job actions
 * (live, generate, direct plot, fullscreen, shortcut help). */
export default function PaintToolbar({
  page,
  desktop,
  liveState,
  liveViewers,
  onToggleLive,
  busy,
  sending,
  printerBusy,
  printerOnline,
  calibrating,
  pageBlocked,
  loadingPreview,
  hasSelection,
  onSetGrid,
  onSetContinuous,
  onCreateGcode,
  onDirectPlot,
  onMoveToCalibration,
  onOpenPressure,
  onPlotSelection,
  onOpenColoring,
  onOpenFullscreen,
  onOpenInfo,
}: {
  page: Page;
  desktop: boolean;
  liveState: StreamState;
  liveViewers: number;
  onToggleLive: () => void;
  busy: boolean;
  sending: boolean;
  printerBusy: boolean;
  printerOnline: boolean;
  calibrating: boolean;
  pageBlocked: boolean;
  loadingPreview: boolean;
  hasSelection: boolean;
  onSetGrid: (patch: Partial<{ step: number; snap: boolean }>) => void;
  onSetContinuous: (continuous: boolean) => void;
  onCreateGcode: () => void;
  onDirectPlot: () => void;
  onMoveToCalibration: () => void;
  onOpenPressure: () => void;
  onPlotSelection: () => void;
  onOpenColoring: () => void;
  onOpenFullscreen: () => void;
  onOpenInfo: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="paint-toolbar">
      <h2>{page.name}</h2>
      <div className="paint-grid-ctl">
        <span className="muted">{t("paint.grid")}</span>
        <Segmented
          value={page.grid.step}
          onChange={(step) => onSetGrid({ step })}
          options={GRID_STEPS.map((s) => ({ value: s, label: String(s) }))}
          suffix={<em className="muted">mm</em>}
        />
        <label className="switch-label">
          <span className="muted">{t("paint.snap")}</span>
          <button className={`switch ${page.grid.snap ? "on" : ""}`}
            onClick={() => onSetGrid({ snap: !page.grid.snap })} aria-pressed={page.grid.snap}>
            <i />
          </button>
        </label>
        <label className="switch-label" title={t("paint.continuousHint")}>
          <span className="muted">{t("paint.slice")}</span>
          <Segmented<string>
            value={page.continuous !== false ? "continuous" : "faithful"}
            onChange={(v) => onSetContinuous(v === "continuous")}
            options={[
              { value: "continuous", label: t("slice.continuous") },
              { value: "faithful", label: t("slice.faithful") },
            ]}
          />
        </label>
      </div>
      <div className="paint-job-actions">
        {!desktop && (
          <LiveButton state={liveState} viewers={liveViewers} onClick={onToggleLive} />
        )}
        <button
          className="primary"
          disabled={busy || sending || pageBlocked}
          title={pageBlocked ? t("paint.gcodeBlocked") : ""}
          onClick={onCreateGcode}
        >
          {busy ? t("paint.generating") : t("paint.generateGcode")}
        </button>
        <PlotActionsMenu
          busy={busy}
          sending={sending}
          printerBusy={printerBusy}
          pageBlocked={pageBlocked}
          hasSelection={hasSelection}
          hasObjects={page.objects.length > 0}
          onDirectPlot={onDirectPlot}
          onPlotSelection={onPlotSelection}
          onOpenColoring={onOpenColoring}
        />
        <button
          type="button"
          className="ghost paint-calibration-btn"
          disabled={!printerOnline || busy || sending || printerBusy || calibrating}
          title={t("paper.moveToCalibHint")}
          aria-label={t("paper.moveToCalib")}
          aria-busy={calibrating}
          onClick={onMoveToCalibration}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <path d="M9 3h6v9l-3 4-3-4V3ZM9 7h6M12 16v3M5 21h14" />
            <path d="M4 10v6m-2-2 2 2 2-2M20 10v6m-2-2 2 2 2-2" />
          </svg>
        </button>
        <button type="button" className="ghost paint-calibration-btn"
          disabled={busy || sending || printerBusy || calibrating}
          onClick={onOpenPressure} title={t("paper.pressure.title")} aria-label={t("paper.pressure.title")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 3v18M17 3v18M4 7h6M14 16h6" />
            <circle cx="7" cy="7" r="2" fill="var(--panel)" />
            <circle cx="17" cy="16" r="2" fill="var(--panel)" />
          </svg>
        </button>
        <button disabled={loadingPreview || busy || pageBlocked} onClick={onOpenFullscreen}>
          {loadingPreview ? t("common.loading") : t("convert.fullscreen")}
        </button>
        <button
          className="ghost paint-info-btn"
          title={t("paint.info.button")}
          aria-label={t("paint.info.button")}
          onClick={onOpenInfo}
        >
          ⓘ
        </button>
      </div>
    </div>
  );
}
