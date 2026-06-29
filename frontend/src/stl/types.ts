// Core types for the STL → plotter-line pipeline.
//
// World space is the model's own coordinate system (mm, right-handed). The
// camera projects it to *screen* space, which uses the same convention as the
// paint editor: x right, y DOWN, so the 2D output drops straight into a
// TemplateSpec without a flip.

export type Vec3 = [number, number, number];

/** A single STL facet: three vertices plus the (unit) face normal. */
export interface Triangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  n: Vec3;
}

export interface Mesh {
  triangles: Triangle[];
  /** Axis-aligned bounding box in world space. */
  min: Vec3;
  max: Vec3;
}

/** A vertex projected to screen space, carrying its camera-space depth. */
export interface ScreenPt {
  x: number;
  y: number;
  /** Distance from the camera along the view direction; smaller = nearer. */
  depth: number;
  /** True when the point is in front of the camera (perspective only). */
  front: boolean;
}

/** A 2D line segment in screen space with per-endpoint depth. */
export interface Segment {
  ax: number;
  ay: number;
  az: number; // depth at a
  bx: number;
  by: number;
  bz: number; // depth at b
}
