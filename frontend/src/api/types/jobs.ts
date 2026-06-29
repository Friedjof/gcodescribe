import type { ColoringColor } from "./paint";
import type { JobProfileStatus } from "./calibration";

export interface JobSource {
  kind?: string;
  // Coloring jobs carry the pen colour, its order and the editor session id so
  // the job list can badge and group them.
  color?: ColoringColor;
  color_label?: string;
  color_order?: number;
  color_group_id?: string;
  [k: string]: unknown;
}

export interface Job {
  filename: string;
  size: number;
  created: number;
  fits?: boolean | null; // does the job still fit the current plot area?
  issue?: string | null; // why it does not fit
  profile?: JobProfileStatus | null; // evaluated against the active profile
  source?: JobSource | null; // sidecar source block (coloring colour, group, …)
}

export interface Position {
  x: number;
  y: number;
  z: number;
  homed: boolean;
  homed_axes: string[];
}

export interface SerialPortCandidate {
  device: string;
  byId?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  serialNumber?: string | null;
  vid?: string | null;
  pid?: string | null;
  likelyPrinter: boolean;
  score: number;
}

export interface PaperState {
  calibration: import("./calibration").Calibration;
  rect: [number, number, number, number] | null;
}

export interface GcodePreview {
  polylines: number[][][];
  travels: number[][][];
  bounds: [number, number, number, number] | null;
  truncated: boolean;
}

export interface GcodePreview3D {
  draws: number[][][]; // polylines of [x, y, z] mm where the pen draws
  travels: number[][][]; // pen-up moves incl. Z lifts
  bounds: [number, number, number, number, number, number] | null; // x,y,z min/max
  truncated: boolean;
}
