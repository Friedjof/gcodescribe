import type { CalibrationController } from "./useCalibrationController";
import EditorIcon from "../../../components/editor/EditorIcon";
import { useI18n } from "../../../i18n";

type Controls = Pick<
  CalibrationController,
  "canMove" | "homed" | "jogXY" | "kbd" | "jogScope" | "rehome"
>;

/** Shared arrow pad for paper capture and the detailed calibration view. */
export default function XYJogPad({ controls: c }: { controls: Controls }) {
  const { t } = useI18n();
  return (
    <div className="jog compact calibration-jog-scope" ref={c.jogScope} tabIndex={0}
      role="group" aria-label={t("paper.keyboardJog")}
      onClickCapture={() => c.jogScope.current?.focus({ preventScroll: true })}>
      <div className="xy">
        <button
          type="button"
          disabled={!c.canMove || !c.homed}
          aria-label="Y+"
          title="Y+"
          onClick={() => c.jogXY(0, 1)}
          className={"up" + c.kbd("up")}
        >
          ↑
        </button>
        <button
          type="button"
          disabled={!c.canMove || !c.homed}
          aria-label="X−"
          title="X−"
          onClick={() => c.jogXY(-1, 0)}
          className={"left" + c.kbd("left")}
        >
          ←
        </button>
        <button type="button" className="pad-center" disabled={!c.canMove}
          aria-label={t("paper.rehome")} title={t("paper.rehomeHint")} onClick={c.rehome}>
          <EditorIcon name="home" size={18} />
        </button>
        <button
          type="button"
          disabled={!c.canMove || !c.homed}
          aria-label="X+"
          title="X+"
          onClick={() => c.jogXY(1, 0)}
          className={"right" + c.kbd("right")}
        >
          →
        </button>
        <button
          type="button"
          disabled={!c.canMove || !c.homed}
          aria-label="Y−"
          title="Y−"
          onClick={() => c.jogXY(0, -1)}
          className={"down" + c.kbd("down")}
        >
          ↓
        </button>
      </div>
    </div>
  );
}
