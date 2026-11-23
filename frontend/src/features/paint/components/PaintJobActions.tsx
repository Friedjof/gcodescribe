import EditorIcon from "../../../components/editor/EditorIcon";
import EditorMenu, {
  type EditorMenuItem,
} from "../../../components/editor/EditorMenu";
import { useI18n } from "../../../i18n";
import LiveButton from "../../stream/components/LiveButton";
import type { StreamState } from "../../stream/lib/protocol";
import PlotActionsMenu from "./PlotActionsMenu";
export interface PaintJobActionsProps {
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
  onCreateGcode: () => void;
  onDirectPlot: () => void;
  onMoveToCalibration: () => void;
  onOpenPressure: () => void;
  onPlotSelection: () => void;
  onOpenColoring: () => void;
  onOpenFullscreen: () => void;
  onOpenInfo: () => void;
}
export default function PaintJobActions({
  hasObjects,
  guided,
  visible,
  ...props
}: PaintJobActionsProps & {
  hasObjects: boolean;
  guided: boolean;
  visible: boolean;
}) {
  const { t } = useI18n();
  const blocked = props.busy || props.sending || props.pageBlocked;
  const settingsBlocked =
    props.busy || props.sending || props.printerBusy || props.calibrating;
  const items: EditorMenuItem[] = [
    {
      id: "export",
      label: t("paint.generateGcode"),
      icon: "folder",
      disabled: blocked || !hasObjects,
      action: props.onCreateGcode,
    },
    {
      id: "pressure",
      label: t("paper.pressure.title"),
      icon: "settings",
      disabled: settingsBlocked,
      separator: true,
      action: props.onOpenPressure,
    },
    {
      id: "help",
      label: t("paint.info.button"),
      icon: "help",
      separator: true,
      action: props.onOpenInfo,
    },
  ];
  if (!props.desktop && guided)
    items.splice(1, 0, {
      id: "live",
      label: t(
        props.liveState === "live" || props.liveState === "connecting"
          ? "paint.stopLive"
          : "paint.startLive",
      ),
      icon: "preview",
      action: props.onToggleLive,
    });
  return (
    <div className="paint-job-actions">
      {!props.desktop && !guided && (
        <LiveButton
          state={props.liveState}
          viewers={props.liveViewers}
          onClick={props.onToggleLive}
        />
      )}
      <button
        type="button"
        className="primary paint-preview-button"
        disabled={props.loadingPreview || blocked || !hasObjects}
        onClick={props.onOpenFullscreen}
        title={!hasObjects ? t("paint.emptyHint") : t("paint.previewHint")}
      >
        <EditorIcon name="preview" size={16} />
        {t(props.loadingPreview ? "common.loading" : "paint.preview")}
      </button>
      {!guided && (
        <button
          type="button"
          disabled={blocked || !hasObjects}
          onClick={props.onCreateGcode}
          title={t("paint.exportHint")}
        >
          {t(props.busy ? "paint.generating" : "paint.generateGcode")}
        </button>
      )}
      <PlotActionsMenu
        busy={props.busy}
        sending={props.sending}
        printerBusy={props.printerBusy}
        printerOnline={props.printerOnline}
        pageBlocked={props.pageBlocked}
        hasSelection={props.hasSelection}
        hasObjects={hasObjects}
        emphasis={false}
        visible={visible}
        onDirectPlot={props.onDirectPlot}
        onPlotSelection={props.onPlotSelection}
        onOpenColoring={props.onOpenColoring}
      />
      <button type="button" className="pen-insertion-button" title={t("paper.moveToCalib")}
        aria-label={t("paper.moveToCalib")} disabled={settingsBlocked || props.pageBlocked || !props.printerOnline}
        onClick={props.onMoveToCalibration}><EditorIcon name="draw" size={19}/></button>
      <EditorMenu
        label={t("paint.moreActions")}
        items={items}
        active={visible}
        className="toolbar-icon-menu"
      >
        <EditorIcon name="more" size={18} />
      </EditorMenu>
    </div>
  );
}
