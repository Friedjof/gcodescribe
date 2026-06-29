// Orbit camera + projection (orthographic and perspective).
//
// Output screen space matches the paint editor: x right, y DOWN. Absolute scale
// is irrelevant here — downstream code fits the projected bounds to the plot
// area — so perspective uses a normalised focal length and ortho passes camera
// units straight through.
import type { ScreenPt, Vec3 } from "./types";
import { cross, dot, normalize, sub } from "./vec";

export type UpAxis = "z" | "y";

export interface Camera {
  /** Look-at point in world space (defaults to the model centre). */
  target: Vec3;
  /** Orbit angles, radians. */
  azimuth: number;
  elevation: number;
  /** Eye distance from target (drives perspective + depth ordering). */
  distance: number;
  perspective: boolean;
  /** Vertical field of view, radians (perspective only). */
  fov: number;
  /** Which world axis points "up" — STL/CAD is usually Z-up. */
  up: UpAxis;
}

export const DEFAULT_CAMERA: Omit<Camera, "target" | "distance"> = {
  azimuth: Math.PI / 4,
  elevation: Math.PI / 6,
  perspective: true,
  fov: (45 * Math.PI) / 180,
  up: "z",
};

export interface CameraBasis {
  eye: Vec3;
  right: Vec3;
  camUp: Vec3;
  forward: Vec3;
  perspective: boolean;
  focal: number;
}

function upVec(up: UpAxis): Vec3 {
  return up === "z" ? [0, 0, 1] : [0, 1, 0];
}

export function eyePosition(cam: Camera): Vec3 {
  const ce = Math.cos(cam.elevation);
  const se = Math.sin(cam.elevation);
  const ca = Math.cos(cam.azimuth);
  const sa = Math.sin(cam.azimuth);
  // Direction from target to eye, expressed for the chosen up-axis.
  const dir: Vec3 =
    cam.up === "z" ? [ce * ca, ce * sa, se] : [ce * ca, se, ce * sa];
  return [
    cam.target[0] + dir[0] * cam.distance,
    cam.target[1] + dir[1] * cam.distance,
    cam.target[2] + dir[2] * cam.distance,
  ];
}

export function cameraBasis(cam: Camera): CameraBasis {
  const eye = eyePosition(cam);
  const forward = normalize(sub(cam.target, eye));
  let up = upVec(cam.up);
  // Guard against gimbal lock when looking straight down the up axis.
  if (Math.abs(dot(forward, up)) > 0.999) up = [1, 0, 0];
  const right = normalize(cross(forward, up));
  const camUp = cross(right, forward); // already unit length
  const focal = 1 / Math.tan(cam.fov / 2);
  return { eye, right, camUp, forward, perspective: cam.perspective, focal };
}

const NEAR = 1e-4;

export function projectPoint(p: Vec3, basis: CameraBasis): ScreenPt {
  const rel = sub(p, basis.eye);
  const camX = dot(rel, basis.right);
  const camY = dot(rel, basis.camUp);
  const depth = dot(rel, basis.forward); // +ve in front of the camera
  if (basis.perspective) {
    const front = depth > NEAR;
    const f = basis.focal / (front ? depth : NEAR);
    return { x: camX * f, y: -camY * f, depth, front };
  }
  return { x: camX, y: -camY, depth, front: depth > 0 };
}

/** True when a face (given its normal + a point on it) is turned toward the eye. */
export function frontFacing(normal: Vec3, point: Vec3, basis: CameraBasis): boolean {
  const viewDir = basis.perspective ? sub(basis.eye, point) : [-basis.forward[0], -basis.forward[1], -basis.forward[2]];
  return dot(normal, viewDir as Vec3) > 0;
}
