import type { SourcePage, Source } from "./sources";

export interface GalleryScore {
  total: number;
  time: number;
  lifts: number;
  size: number;
  detail: number;
}

export interface GalleryMetrics {
  size_bytes: number;
  command_count: number;
  pen_lifts: number;
  polyline_count: number;
  point_count: number;
  draw_mm: number;
  travel_mm: number;
  duration_s: number;
  points_per_mm: number;
}

export type GalleryUploader = "admin" | "public";

export interface GalleryOriginal {
  filename: string;
  kind: string;
  mime: string;
  size: number;
}

export interface GalleryItem {
  id: string;
  title: string;
  filename: string;
  // Images/SVG for public submissions; admin assets add PDF/Office kinds.
  kind: string;
  uploader: GalleryUploader;
  created: number;
  status: "active" | "archived";
  mode: Source["mode"];
  detail: number;
  continuous?: boolean;
  pages: SourcePage[];
  width: number;
  height: number;
  lines: number;
  original?: GalleryOriginal | null;
  // Only single-page public submissions are scored on upload; admin assets
  // (documents, multi-page) carry neither until placement.
  metrics?: GalleryMetrics;
  score?: GalleryScore;
  // STL assets keep the orientation/render params for later re-rendering.
  stl_params?: Record<string, unknown> | null;
}

/** One pen-colour layer of an STL render, posted to the gallery. */
export interface StlLayerPayload {
  color: string;
  role: "visible" | "hidden";
  order: number;
  svg: string;
}

export interface GallerySvg {
  polylines: number[][][];
  width: number;
  height: number;
}

/** One page of a gallery item, rendered on demand. Single-page submissions omit
 * `bounds`; multi-page admin assets carry the page's content bounds. */
export interface GalleryPreview {
  polylines: number[][][];
  bounds?: [number, number, number, number] | null;
  width: number;
  height: number;
}
