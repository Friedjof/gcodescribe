import { useEffect } from "react";
import type { GcodePreview3D } from "../api";
import Gcode3D from "./Gcode3D";

/** Fullscreen 3D G-code view. Closes on backdrop click or Escape. */
export default function Gcode3DOverlay({
  data,
  showTravels = true,
  onClose,
}: {
  data: GcodePreview3D;
  showTravels?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="g3d-fullscreen" onClick={onClose}>
      <div className="g3d-fullscreen-view" onClick={(e) => e.stopPropagation()}>
        <Gcode3D data={data} chrome={false} showTravels={showTravels} />
      </div>
    </div>
  );
}
