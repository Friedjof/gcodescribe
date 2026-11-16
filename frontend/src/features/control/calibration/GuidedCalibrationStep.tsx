import type { GuidedCalibrationTaskProps as Props } from "./guided/types";
import type { CalibrationStep } from "./steps";
import HomeTask from "./guided/HomeTask";
import PenTask from "./guided/PenTask";
import PaperTask from "./guided/PaperTask";
import ReviewTask from "./guided/ReviewTask";
import SpecialPositions from "../SpecialPositions";
import ObstaclesStep from "./ObstaclesStep";
export default function GuidedCalibrationStep({
  id,
  controls,
}: Props & { id: CalibrationStep }) {
  switch (id) {
    case "home":
      return <HomeTask controls={controls} />;
    case "pen":
      return <PenTask controls={controls} />;
    case "corners":
      return <PaperTask controls={controls} />;
    case "apply":
      return <ReviewTask controls={controls} />;
    case "positions":
      return (
        <SpecialPositions
          cal={controls.cal!}
          pos={controls.pos}
          controls={controls.positions}
          onNext={controls.finishPositions}
          onOpenPressure={() => controls.setPressureOpen(true)}
        />
      );
    case "obstacles":
      return <ObstaclesStep controls={controls} />;
  }
}
