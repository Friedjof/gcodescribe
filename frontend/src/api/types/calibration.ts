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
  pen_up_z: number;
  pen_down_z: number;
  pen_calibrated: boolean;
  travel_feed: number;
  draw_feed: number;
  z_feed: number;
  fit_to_area: boolean;
  flip_y: boolean;
  trust_axis_home: boolean;
  park_after_plot: boolean;
  paper_corners: Record<string, [number, number]>;
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
