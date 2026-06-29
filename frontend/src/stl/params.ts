// Serializable render parameters — what the editor keeps in state and what the
// gallery persists so a stored STL can be re-opened and re-rendered identically.
import type { Camera, UpAxis } from "./camera";
import type { HiddenMode } from "./render";
import type { Mesh, Vec3 } from "./types";

export interface StlParams {
  azimuth: number;
  elevation: number;
  /** Eye distance as a multiple of the model's bounding diagonal (scale-free). */
  distanceFactor: number;
  perspective: boolean;
  fov: number;
  up: UpAxis;
  featureAngleDeg: number;
  hidden: HiddenMode;
  colorVisible: string;
  colorHidden: string;
  /** Show every mesh triangle edge in the 3D inspect view (not in the output). */
  showTriangles: boolean;
  /** Flat-shade the faces in the 3D inspect view. */
  shading: boolean;
  /** Face opacity in the 3D inspect view (0.1–1) — lower = see-through. */
  opacity: number;
  /** Dimension annotation style (baked into the plotted output). */
  dimStyle: DimStyle;
  /** Add a corner size table (W/H/D values) to the output. */
  sizeTable: boolean;
  /** Join each colour into one continuous line (easier to colour/separate). */
  continuous: boolean;
}

export type DimStyle = "none" | "box" | "arrows";

export const DEFAULT_PARAMS: StlParams = {
  azimuth: Math.PI / 4,
  elevation: Math.PI / 6,
  distanceFactor: 2.6,
  perspective: true,
  fov: (45 * Math.PI) / 180,
  up: "z",
  featureAngleDeg: 25,
  hidden: "remove",
  colorVisible: "black",
  colorHidden: "red",
  showTriangles: false,
  shading: true,
  opacity: 1,
  dimStyle: "none",
  sizeTable: false,
  continuous: false,
};

export function meshCenter(mesh: Mesh): Vec3 {
  return [
    (mesh.min[0] + mesh.max[0]) / 2,
    (mesh.min[1] + mesh.max[1]) / 2,
    (mesh.min[2] + mesh.max[2]) / 2,
  ];
}

export function meshDiagonal(mesh: Mesh): number {
  return Math.max(
    Math.hypot(mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1], mesh.max[2] - mesh.min[2]),
    1e-6,
  );
}

export function cameraFromParams(params: StlParams, mesh: Mesh): Camera {
  return {
    target: meshCenter(mesh),
    azimuth: params.azimuth,
    elevation: params.elevation,
    distance: meshDiagonal(mesh) * params.distanceFactor,
    perspective: params.perspective,
    fov: params.fov,
    up: params.up,
  };
}

/** Orientation presets (azimuth, elevation) in radians. */
export const PRESETS: Record<string, [number, number]> = {
  front: [0, 0],
  back: [Math.PI, 0],
  left: [-Math.PI / 2, 0],
  right: [Math.PI / 2, 0],
  top: [0, Math.PI / 2 - 0.001],
  iso: [Math.PI / 4, Math.PI / 6],
};
