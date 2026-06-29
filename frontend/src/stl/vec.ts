// Minimal Vec3 helpers — kept tiny and allocation-light for the n² occlusion.
import type { Vec3 } from "./types";

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 1e-12 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
}

/** Face normal from three vertices (right-hand rule, CCW front). */
export function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return normalize(cross(sub(b, a), sub(c, a)));
}
