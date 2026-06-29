import type { GcodePreview3D } from "./jobs";
import type { GalleryScore, GalleryMetrics } from "./gallery";

export interface MazeResponse {
  type: "classic" | "masked" | "hex" | "polar";
  seed: string;
  size: number;
  width: number;
  height: number;
  viewBox: string;
  maze_svg: string;
  solution_svg: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  wall_lines: number[][][];
  marker_lines: number[][][];
  solution_lines: number[][][];
  metadata: Record<string, string | number | boolean>;
}

export interface SudokuResponse {
  seed: string;
  difficulty: "easy" | "medium" | "hard";
  puzzle: number[][];
  solution: number[][];
  metadata: Record<string, string | number | boolean | string[]>;
}

export interface ColoringPageResponse {
  function: "mandala" | "math_pattern";
  mode: string;
  seed: string;
  width: number;
  height: number;
  viewBox: string;
  svg: string;
  lines: number[][][];
  metadata: Record<string, string | number | boolean>;
}

export interface OsmMapRequest {
  south: number;
  west: number;
  north: number;
  east: number;
  width: number;
  height: number;
  detail: number;
  includeFrame?: boolean;
  areaId?: number | null;
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
  south: number;
  west: number;
  north: number;
  east: number;
  osmType: string;
  osmId: number;
  areaId: number | null;
}

export interface OsmMapGcode {
  gcode3d: GcodePreview3D;
  score: GalleryScore;
  metrics: GalleryMetrics;
}

export interface OsmMapResponse {
  width: number;
  height: number;
  viewBox: string;
  lines: number[][][];
  metadata: Record<string, unknown>;
}
