import PaperTask from "./guided/PaperTask";
import type { CalibrationController } from "./useCalibrationController";
import type { Calibration } from "../../../api";

export default function CornersStep({ controls }: { cal: Calibration; controls: CalibrationController }) {
  return <PaperTask controls={controls} />;
}
