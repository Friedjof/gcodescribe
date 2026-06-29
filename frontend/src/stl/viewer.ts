// Lightweight shaded preview of the mesh on a 2D canvas, using the same camera
// orientation as the plotter projection. Like the G-code 3D viewer it rotates
// the model *in place*: a fixed centre and a fixed scale (from the model size,
// not the per-frame projected bounds), so orbiting never makes the model drift
// or rescale.
import { cameraBasis, frontFacing, projectPoint, type Camera } from "./camera";
import { selectEdges, type EdgeModel } from "./edges";
import { meshCenter } from "./params";
import type { Mesh, Vec3 } from "./types";
import { dot, normalize } from "./vec";

const LIGHT: Vec3 = normalize([0.4, -0.6, 0.8]);

export interface ViewportOpts {
  featureAngleDeg: number;
  showTriangles: boolean;
  shading: boolean;
  opacity: number;
  showBox: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

export function drawMesh3d(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  mesh: Mesh,
  model: EdgeModel,
  camera: Camera,
  opts: ViewportOpts,
): void {
  ctx.clearRect(0, 0, cssW, cssH);
  const basis = cameraBasis(camera);

  // Fixed centre + scale → in-place rotation (orthographic inspect view).
  const center = meshCenter(mesh);
  const dimX = mesh.max[0] - mesh.min[0];
  const dimY = mesh.max[1] - mesh.min[1];
  const dimZ = mesh.max[2] - mesh.min[2];
  const extent = Math.max(dimX, dimY, dimZ, 1e-6);
  const pc = projectPoint(center, basis);
  const scale = (Math.min(cssW, cssH) * 0.78 / extent) * opts.zoom;
  const ox = cssW / 2 + opts.panX;
  const oy = cssH / 2 + opts.panY;
  const sx = (x: number) => ox + (x - pc.x) * scale;
  const sy = (y: number) => oy + (y - pc.y) * scale;
  const project2 = (p: Vec3): [number, number] => {
    const pp = projectPoint(p, basis);
    return [sx(pp.x), sy(pp.y)];
  };

  const proj = mesh.triangles.map((t) => ({
    pa: projectPoint(t.a, basis),
    pb: projectPoint(t.b, basis),
    pc: projectPoint(t.c, basis),
    t,
  }));

  const front = proj
    .filter((p) => frontFacing(p.t.n, p.t.a, basis))
    .map((p) => ({ ...p, depth: (p.pa.depth + p.pb.depth + p.pc.depth) / 3 }))
    .sort((a, b) => b.depth - a.depth);

  if (opts.shading && opts.opacity > 0.02) {
    ctx.globalAlpha = opts.opacity;
    for (const f of front) {
      const shade = 0.34 + 0.6 * Math.max(0, dot(f.t.n, LIGHT));
      const c = Math.round(shade * 255);
      ctx.fillStyle = `rgb(${c},${c},${Math.min(255, c + 10)})`;
      ctx.beginPath();
      ctx.moveTo(sx(f.pa.x), sy(f.pa.y));
      ctx.lineTo(sx(f.pb.x), sy(f.pb.y));
      ctx.lineTo(sx(f.pc.x), sy(f.pc.y));
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (opts.showTriangles) {
    ctx.strokeStyle = "rgba(96,150,220,0.6)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const f of front) {
      ctx.moveTo(sx(f.pa.x), sy(f.pa.y));
      ctx.lineTo(sx(f.pb.x), sy(f.pb.y));
      ctx.lineTo(sx(f.pc.x), sy(f.pc.y));
      ctx.closePath();
    }
    ctx.stroke();
  }

  // Feature + silhouette edges — light when the faces are dark/transparent.
  const lightEdges = !opts.shading || opts.opacity < 0.5;
  const edges = selectEdges(model, basis, (opts.featureAngleDeg * Math.PI) / 180);
  ctx.strokeStyle = lightEdges ? "rgba(225,228,235,0.95)" : "rgba(12,12,18,0.92)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (const e of edges) {
    const [ax, ay] = project2(e.a);
    const [bx, by] = project2(e.b);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();

  if (opts.showBox) drawBoundingBox(ctx, mesh, project2, dimX, dimY, dimZ);
}

function drawBoundingBox(
  ctx: CanvasRenderingContext2D,
  mesh: Mesh,
  project2: (p: Vec3) => [number, number],
  dimX: number,
  dimY: number,
  dimZ: number,
): void {
  const [x0, y0, z0] = mesh.min;
  const [x1, y1, z1] = mesh.max;
  const c: Vec3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const p = c.map(project2);
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  ctx.strokeStyle = "rgba(255,176,32,0.85)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (const [a, b] of edges) {
    ctx.moveTo(p[a][0], p[a][1]);
    ctx.lineTo(p[b][0], p[b][1]);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Dimension labels, pushed to the outer side so they never cover the model.
  const box = p.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]);
  const cx = box[0] / p.length, cy = box[1] / p.length;
  ctx.fillStyle = "rgba(255,205,100,0.98)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = (a: number, b: number, value: number) => {
    const mx = (p[a][0] + p[b][0]) / 2;
    const my = (p[a][1] + p[b][1]) / 2;
    const dx = mx - cx, dy = my - cy;
    const len = Math.hypot(dx, dy) || 1;
    ctx.fillText(`${value.toFixed(1)} mm`, mx + (dx / len) * 16, my + (dy / len) * 16);
  };
  label(0, 1, dimX); // along X
  label(0, 3, dimY); // along Y
  label(0, 4, dimZ); // along Z
}
