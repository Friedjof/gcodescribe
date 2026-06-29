// High-level glue used by the editor and (later) the gallery: mesh + options →
// fitted, coloured plotter layers + a TemplateSpec for Paint insertion.
import { cameraBasis, projectPoint, type Camera } from "./camera";
import { arrowDimensions, boxLabels, sizeTable, type DimItem, type DimLabels } from "./dimensions";
import type { EdgeModel } from "./edges";
import { occlude } from "./hiddenLine";
import type { DimStyle } from "./params";
import { fitLayers, renderMesh, type HiddenMode, type Pt2 } from "./render";
import { polylinesToSvg } from "./svg";
import type { Vec3 } from "./types";

export interface StlPenColor {
  visible: string; // pen colour key for visible edges, e.g. "black"
  hidden: string;  // pen colour key for hidden edges (secondColor mode)
}

export interface StlComputeOptions {
  camera: Camera;
  featureAngleDeg: number;
  hidden: HiddenMode;
  colors: StlPenColor;
  /** One continuous line per colour (default true). */
  continuous?: boolean;
  /** Model bounding box (min, max) for dimension annotations. */
  bbox?: [Vec3, Vec3];
  /** Up-axis (for width/height/depth mapping). */
  up?: "z" | "y";
  /** Localized W/H/D abbreviations (uppercase). Required for any dimensioning. */
  dimLabels?: DimLabels;
  /** Dimension annotation style baked into the output. */
  dimStyle?: DimStyle;
  /** Add a corner size table. */
  sizeTable?: boolean;
  /** Plot area to fit into (mm). */
  plotWidth: number;
  plotHeight: number;
}

/** Projected, fitted bounding box for dimension annotations in the preview. */
export interface StlBox {
  /** 8 corners in fitted plot space, ordered (x,y,z) bit pattern 000..111. */
  corners: Pt2[];
  /** Real model extents [X, Y, Z] in source units. */
  dims: [number, number, number];
}

export interface StlLayer {
  color: string;
  role: "visible" | "hidden";
  polylines: Pt2[][];
}

export interface StlComputeResult {
  layers: StlLayer[];
  width: number;
  height: number;
  /** Total point count, for a cheap complexity readout. */
  points: number;
  box: StlBox | null;
}

export function computeStl(model: EdgeModel, opts: StlComputeOptions): StlComputeResult {
  const rendered = renderMesh(model, {
    camera: opts.camera,
    featureAngleDeg: opts.featureAngleDeg,
    hidden: opts.hidden,
    continuous: opts.continuous,
  });
  const fitted = fitLayers(rendered, opts.plotWidth, opts.plotHeight);

  // Project the model's bounding box through the same camera + fit transform so
  // its (now oblique) edges line up with the drawing for dimensioning.
  let box: StlBox | null = null;
  const corners3d: Vec3[] = [];
  const cornerDepth: number[] = [];
  if (opts.bbox) {
    const [mn, mx] = opts.bbox;
    const basis = cameraBasis(opts.camera);
    const corners: Pt2[] = [];
    for (let k = 0; k < 8; k++) {
      const c: Vec3 = [k & 1 ? mx[0] : mn[0], k & 2 ? mx[1] : mn[1], k & 4 ? mx[2] : mn[2]];
      corners3d.push(c);
      const p = projectPoint(c, basis);
      cornerDepth.push(p.depth);
      corners.push([(p.x - fitted.x0) * fitted.scale, (p.y - fitted.y0) * fitted.scale]);
    }
    box = { corners, dims: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
  }
  let points = 0;
  const layers: StlLayer[] = fitted.layers
    .filter((l) => l.polylines.length > 0)
    .map((l) => {
      points += l.polylines.reduce((s, line) => s + line.length, 0);
      return {
        role: l.role,
        color: l.role === "hidden" ? opts.colors.hidden : opts.colors.visible,
        polylines: l.polylines,
      };
    });
  // Bake the chosen dimension annotations into the visible layer so they become
  // part of the plotted SVG, not just a preview overlay.
  const style: DimStyle = opts.dimStyle ?? "none";
  if (box && opts.dimLabels && (style !== "none" || opts.sizeTable)) {
    const up = opts.up ?? "z";
    const L = opts.dimLabels;
    const c2d = box.corners;
    const textH = Math.max(Math.max(fitted.width, fitted.height) * 0.045, 2);
    const cx = c2d.reduce((s, c) => s + c[0], 0) / 8;
    const cy = c2d.reduce((s, c) => s + c[1], 0) / 8;
    const center: [number, number] = [cx, cy];

    // The 4 parallel edges per axis; dimension the *frontmost* one so labels sit
    // on a visible side and never behind the model.
    const X: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7]];
    const Y: [number, number][] = [[0, 2], [1, 3], [4, 6], [5, 7]];
    const Z: [number, number][] = [[0, 4], [1, 5], [2, 6], [3, 7]];
    const front = (edges: [number, number][]) =>
      edges.reduce((best, e) =>
        (cornerDepth[e[0]] + cornerDepth[e[1]]) < (cornerDepth[best[0]] + cornerDepth[best[1]]) ? e : best);
    const mk = (e: [number, number], len: number, label: string): DimItem =>
      ({ a: c2d[e[0]], b: c2d[e[1]], len, label });
    const items: DimItem[] = [
      mk(front(X), box.dims[0], L.w),
      mk(front(up === "z" ? Z : Y), up === "z" ? box.dims[2] : box.dims[1], L.h),
      mk(front(up === "z" ? Y : Z), up === "z" ? box.dims[1] : box.dims[2], L.d),
    ];

    const extras: Pt2[][] = [];
    if (style === "box") {
      // Occlude the 12 cage edges against the mesh so hidden edges disappear.
      const basis = cameraBasis(opts.camera);
      const CAGE: [number, number][] = [...X, ...Y, ...Z];
      const cands = CAGE.map(([a, b]) => ({ a: corners3d[a], b: corners3d[b], front: true }));
      const minLen = Math.max(fitted.width, fitted.height) * 0.003;
      const { visible: vis } = occlude(cands, model.triangles, basis, { removeHidden: true, minLen });
      for (const seg of vis) {
        extras.push([
          [(seg.a[0] - fitted.x0) * fitted.scale, (seg.a[1] - fitted.y0) * fitted.scale],
          [(seg.b[0] - fitted.x0) * fitted.scale, (seg.b[1] - fitted.y0) * fitted.scale],
        ]);
      }
      extras.push(...boxLabels(items, c2d, center, textH));
    } else if (style === "arrows") {
      extras.push(...arrowDimensions(items, c2d, center, textH));
    }
    if (opts.sizeTable) {
      extras.push(...sizeTable(items, textH, [0, 0, fitted.width, fitted.height]));
    }

    const visible = layers.find((l) => l.role === "visible");
    if (visible) visible.polylines = [...visible.polylines, ...extras];
    else layers.push({ role: "visible", color: opts.colors.visible, polylines: extras });
    points += extras.reduce((s, line) => s + line.length, 0);
  }

  return { layers, width: fitted.width, height: fitted.height, points, box };
}

/** All layers' polylines flattened — for single-object Paint insertion / preview. */
export function allPolylines(result: StlComputeResult): Pt2[][] {
  return result.layers.flatMap((l) => l.polylines);
}

export interface StlSvgLayer {
  color: string;
  role: "visible" | "hidden";
  order: number;
  svg: string;
}

/** One continuous-line SVG per pen colour, for gallery storage / plotting. */
export function resultToSvgLayers(result: StlComputeResult): StlSvgLayer[] {
  return result.layers.map((l, i) => ({
    color: l.color,
    role: l.role,
    order: i + 1,
    svg: polylinesToSvg(l.polylines, result.width, result.height, l.color),
  }));
}
