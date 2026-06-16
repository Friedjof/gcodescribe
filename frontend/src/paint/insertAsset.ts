// Shared helpers for turning an uploaded asset (gallery item or placement
// source) into an `image` SceneObject on the designer canvas. Pure functions —
// the two existing bridges (GalleryDetail → designer, Place → designer) and the
// future gallery popup all build the same object through here.

import { localize, type Pt } from "./geometry";
import type {
  GalleryItem,
  GalleryPreview,
  GallerySvg,
  SceneObject,
  Source,
  SourcePreview,
} from "../api";

type CalArea = { plot_width: number; plot_height: number };

/** Uniform scale that fits a width×height drawing into ~90% of the plot area,
 * never upscaling past 1. */
export function fitScale(width: number, height: number, cal: CalArea): number {
  return Math.min(
    1,
    (cal.plot_width * 0.9) / Math.max(width, 1),
    (cal.plot_height * 0.9) / Math.max(height, 1)
  );
}

/** Build a centred `image` SceneObject from local (already centred) polylines. */
export function imageObject(
  local: Pt[][],
  scale: number,
  data: Record<string, unknown>,
  cal: CalArea
): SceneObject {
  return {
    id: crypto.randomUUID(),
    type: "image",
    data: { ...data, basePolylines: local },
    cachedPolylines: local,
    transform: { x: cal.plot_width / 2, y: cal.plot_height / 2, rotation: 0, scale },
    plotted: false,
  };
}

/** Base name for a gallery item, optionally suffixed with the page number for
 * multi-page assets. */
function galleryName(item: GalleryItem, page?: number): string {
  const base = item.title || item.filename.replace(/\.[^.]+$/, "");
  return page && item.pages && item.pages.length > 1 ? `${base} · S.${page}` : base;
}

/** Gallery item → image object, fitted to the plot area and centred. */
export function galleryItemObject(item: GalleryItem, svg: GallerySvg, cal: CalArea): SceneObject {
  const { local } = localize(svg.polylines as Pt[][]);
  return imageObject(
    local,
    fitScale(svg.width, svg.height, cal),
    { galleryId: item.id, name: galleryName(item) },
    cal
  );
}

/** Gallery item page → image object, fitted to the plot area and centred.
 * Used for multi-page admin assets where a specific page is inserted; the
 * content bounds (when present) drive the fit so margins don't shrink it. */
export function galleryPageObject(
  item: GalleryItem,
  preview: GalleryPreview,
  page: number,
  cal: CalArea
): SceneObject {
  const { local } = localize(preview.polylines as Pt[][]);
  const contentW = preview.bounds ? preview.bounds[2] - preview.bounds[0] : preview.width;
  const contentH = preview.bounds ? preview.bounds[3] - preview.bounds[1] : preview.height;
  return imageObject(
    local,
    fitScale(contentW, contentH, cal),
    { galleryId: item.id, galleryPage: page, name: galleryName(item, page) },
    cal
  );
}

/** Placement source preview → image object scaled to a target content width. */
export function sourcePlacementObject(
  source: Source,
  preview: SourcePreview,
  placeWidth: number,
  cal: CalArea
): SceneObject {
  const name = source.name.replace(/\.[^.]+$/, "");
  const { local } = localize(preview.polylines as Pt[][]);
  const contentW = preview.bounds ? preview.bounds[2] - preview.bounds[0] : preview.width;
  const scale = placeWidth / Math.max(contentW, 1);
  return imageObject(local, scale, { sourceId: source.id, name }, cal);
}
