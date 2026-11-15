import type { ProfileRef } from "./calibration";
import type { GalleryScore, GalleryMetrics } from "./gallery";

// Coloring: split a page's lines onto a few pen colours and slice one job per
// colour. The catalogue is shared with the backend (plotter/web/routes/pages).
export type ColoringColor = "black" | "red" | "blue" | "green";

export interface ColoringApiItem {
  color: ColoringColor;
  label: string;
  order: number;
  objects: SceneObject[];
}

// Persisted per-page coloring session: segment colours keyed by line geometry
// hash (see paint/coloring lineKey) plus the colour plot order.
export interface PageColoring {
  assignments: Record<string, (ColoringColor | null)[]>;
  order: ColoringColor[];
}

export interface PageGrid {
  step: number;
  snap: boolean;
}

// A scene object. Phase 1 stores them opaquely; later phases fill in data.
export interface SceneObject {
  id: string;
  type: "image" | "text" | "freehand" | "pen" | "line" | "rect" | "circle" | "semicircle" | string;
  transform?: { x: number; y: number; rotation: number; scale: number; scaleX?: number; scaleY?: number };
  zOrder?: number;
  groupId?: string;
  data?: any;
  cachedPolylines?: number[][][];
  cachedFeeds?: number[][];
  plotted?: boolean;
}

export type PageProfileStatus = "active" | "other" | "stale" | "missing" | "archived";

export interface Page {
  revision?: number;
  id: string;
  name: string;
  objects: SceneObject[];
  grid: PageGrid;
  markdown?: string | null;
  created: number;
  modified: number;
  profileId?: string | null;
  profileName?: string | null;
  profileFingerprint?: string | null;
  profileStatus?: PageProfileStatus;
  projectId?: string;
  profileSnapshot?: { profileId: string; profileName: string; fingerprint: string; calibration: import("./calibration").Calibration; capturedAt: number };
  coloring?: PageColoring | null;
  // Manual folder the page was dragged into (null = grouped by profile).
  groupId?: string | null;
  // Plot as one continuous stroke per connected component (eulerised) — far
  // fewer pen lifts, with retraces. New OSM map pages opt out by default.
  continuous?: boolean;
}

export interface PageThumb {
  d: string;
  w: number;
  h: number;
}

export interface PageMeta {
  id: string;
  name: string;
  created: number;
  modified: number;
  objectCount: number;
  plottedCount: number;
  thumb?: PageThumb | null;
  profileId?: string | null;
  profileName?: string | null;
  profileFingerprint?: string | null;
  profileStatus?: PageProfileStatus;
  groupId?: string | null;
  projectId?: string;
}

export interface PageGroup {
  id: string;
  name: string;
  projectId?: string;
  parentId?: string | null;
}

export interface PaintProject {
  id: string;
  name: string;
  profileId: string;
  activeId: string | null;
  modified: number;
  archived: boolean;
  slideCount?: number;
  coverPageId?: string | null;
  coverModified?: number | null;
}

export interface PageIndex {
  order: PageMeta[];
  activeId: string | null;
  groups?: PageGroup[];
  project?: PaintProject;
  projects?: PaintProject[];
  activeProfile?: ProfileRef & {
    plot_width: number;
    plot_height: number;
    origin_x: number;
    origin_y: number;
  };
}

/** Live plottability rating of a paint page (same scale as the gallery). */
export interface PageScore {
  score: GalleryScore | null;
  metrics: GalleryMetrics | null;
  reason: string | null;
}
