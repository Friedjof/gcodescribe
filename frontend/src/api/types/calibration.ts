export type PositionKind = "park" | "calibration";

/** A rectangular no-go zone in printer/bed coordinates (mm). */
export interface Obstacle {
  id: string;
  x: number;  // left edge (printer mm)
  y: number;  // bottom edge (printer mm, y-up)
  w: number;  // width mm
  h: number;  // height mm
}

export interface Calibration {
  bed_width: number;
  bed_height: number;
  z_max: number;
  plot_width: number;
  plot_height: number;
  origin_x: number;
  origin_y: number;
  /** Outer plot rectangle before applying the inward paper margin. */
  plot_area_base?: { x: number; y: number; w: number; h: number } | null;
  pen_up_z: number;
  pen_down_z: number;
  /** Optional maximum extra downward travel for Xournal pressure, in mm. */
  pen_pressure_max_depth?: number;
  pen_calibrated: boolean;
  travel_feed: number; // mm/s
  draw_feed: number; // mm/s
  z_feed: number; // mm/s
  z_max_feedrate: number; // mm/s (firmware M203 limit)
  fit_to_area: boolean;
  flip_y: boolean;
  trust_axis_home: boolean;
  park_after_plot: boolean;
  park_x: number;
  park_y: number;
  park_lift_z: number;
  calibration_x: number;
  calibration_y: number;
  calibration_pressure_offset?: number;
  /** Positions explicitly set in this profile, excluding automatic defaults. */
  defined_positions?: PositionKind[];
  paper_corners: Record<string, [number, number]>;
  paper_diagonal?: "bl-tr" | "tl-br" | null;
  paper_generated_corners?: string[];
  paper_margin: number;
  obstacles: Obstacle[];
  merge_tolerance: number;
}

export interface CalibrationProfileSummary {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
  created: number;
  modified: number;
  fingerprint: string;
  plot_width: number;
  plot_height: number;
  origin_x: number;
  origin_y: number;
  paper_margin: number;
  pen_calibrated: boolean;
}

export interface CalibrationProfile extends CalibrationProfileSummary {
  calibration: Calibration;
}

/** Compact reference to the profile a job/page was generated with. */
export interface ProfileRef {
  id: string | null;
  name: string | null;
  fingerprint: string | null;
}

export interface JobProfileStatus extends ProfileRef {
  matchesActive: boolean;
  stale: boolean; // same profile, but its calibration changed since
  legacy: boolean; // job has no profile metadata at all
  missing: boolean; // sidecar references a profile that no longer exists
  archived: boolean; // sidecar references an archived profile
}

export interface ProfileImportResult {
  imported: string[];
  replaced: string[];
  skipped: string[];
  profiles: CalibrationProfileSummary[];
}
