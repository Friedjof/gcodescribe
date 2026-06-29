export { parseStl } from "./parseStl";
export { prepareMesh } from "./render";
export type { Pt2, HiddenMode } from "./render";
export { computeStl, allPolylines, resultToSvgLayers } from "./compute";
export { stlColoring } from "./coloring";
export type { StlComputeResult, StlLayer, StlPenColor, StlSvgLayer } from "./compute";
export { polylinesToSvg } from "./svg";
export { drawMesh3d } from "./viewer";
export {
  DEFAULT_PARAMS,
  PRESETS,
  cameraFromParams,
  meshCenter,
  meshDiagonal,
} from "./params";
export type { StlParams, DimStyle } from "./params";
export type { Mesh } from "./types";
export type { EdgeModel } from "./edges";
export type { Camera, UpAxis } from "./camera";
