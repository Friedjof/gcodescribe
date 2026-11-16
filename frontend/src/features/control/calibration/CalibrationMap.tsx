import type { Calibration } from "../../../api";
import LiveView from "../LiveView";
import type { CalibrationPreviewControls } from "./CalibrationPreview";
export default function CalibrationMap({
  cal,
  controls,
}: {
  cal: Calibration;
  controls: CalibrationPreviewControls;
}) {
  const {
    positionsOpen,
    positions,
    visible,
    clickMove,
    homed,
    canMove,
    moveTo,
    active,
    handleDragCorner,
    handleDropCorner,
    canEdit,
    currentFormat,
    formatLandscape,
  } = controls;
  return (
    <LiveView
      key={visible ? "visible" : "hidden"}
      cal={cal}
      position={controls.pos}
      rect={controls.rect}
      preview={controls.preview}
      onMoveTo={
        positionsOpen
          ? positions.ready && !positions.busy
            ? (x, y) => positions.move({ x, y })
            : undefined
          : visible && clickMove && homed && canMove
            ? moveTo
            : undefined
      }
      selectedPosition={positionsOpen ? positions.kind : null}
      target={positions.target}
      onDragCorner={
        visible && canEdit && active === "corners"
          ? handleDragCorner
          : undefined
      }
      onDropCorner={
        visible && canEdit && active === "corners"
          ? handleDropCorner
          : undefined
      }
      formatPreview={
        currentFormat
          ? { format: currentFormat, landscape: formatLandscape }
          : undefined
      }
      obstacles={controls.obstacles}
      editingObstacles={visible && canEdit && active === "obstacles"}
      onObstaclesChange={canEdit ? controls.saveObstacles : undefined}
    />
  );
}
