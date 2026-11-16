import type { CalibrationController } from "./useCalibrationController";

type Controls = Pick<
  CalibrationController,
  "canMove" | "homed" | "jogXY" | "kbd"
>;

/** Shared arrow pad for paper capture and the detailed calibration view. */
export default function XYJogPad({ controls: c }: { controls: Controls }) {
  return (
    <div className="jog compact">
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
        <span className="pad-center">XY</span>
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
