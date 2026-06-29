import { describe, expect, it } from "vitest";
import { parseStl } from "./parseStl";
import { DEFAULT_CAMERA, cameraBasis, type Camera } from "./camera";
import { buildEdgeModel, selectEdges } from "./edges";
import { occlude } from "./hiddenLine";
import { fitLayers, prepareMesh, renderMesh } from "./render";
import type { Mesh, Triangle, Vec3 } from "./types";
import { faceNormal } from "./vec";

// --- a unit cube [0,1]^3 as 12 triangles with outward normals ---
function tri(a: Vec3, b: Vec3, c: Vec3): Triangle {
  return { a, b, c, n: faceNormal(a, b, c) };
}

function quad(p: Vec3, q: Vec3, r: Vec3, s: Vec3): Triangle[] {
  return [tri(p, q, r), tri(p, r, s)];
}

function cubeMesh(): Mesh {
  const v: Vec3[] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const tris: Triangle[] = [
    ...quad(v[0], v[3], v[2], v[1]), // bottom (z=0), normal -z
    ...quad(v[4], v[5], v[6], v[7]), // top (z=1), normal +z
    ...quad(v[0], v[1], v[5], v[4]), // y=0
    ...quad(v[2], v[3], v[7], v[6]), // y=1
    ...quad(v[1], v[2], v[6], v[5]), // x=1
    ...quad(v[3], v[0], v[4], v[7]), // x=0
  ];
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [1, 1, 1];
  return { triangles: tris, min, max };
}

function cornerCamera(): Camera {
  return { ...DEFAULT_CAMERA, target: [0.5, 0.5, 0.5], distance: 6, azimuth: 0.6, elevation: 0.5 };
}

// Build a binary STL ArrayBuffer for a single triangle, to exercise the parser.
function binaryStl(tris: Triangle[]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const t of tris) {
    const all = [t.n, t.a, t.b, t.c];
    for (const vec of all) {
      dv.setFloat32(off, vec[0], true);
      dv.setFloat32(off + 4, vec[1], true);
      dv.setFloat32(off + 8, vec[2], true);
      off += 12;
    }
    off += 2; // attribute byte count
  }
  return buf;
}

describe("parseStl", () => {
  it("reads a binary cube", () => {
    const mesh = parseStl(binaryStl(cubeMesh().triangles));
    expect(mesh.triangles).toHaveLength(12);
    expect(mesh.min).toEqual([0, 0, 0]);
    expect(mesh.max).toEqual([1, 1, 1]);
  });

  it("reads an ASCII facet", () => {
    const ascii = `solid t
 facet normal 0 0 1
  outer loop
   vertex 0 0 0
   vertex 1 0 0
   vertex 0 1 0
  endloop
 endfacet
endsolid t`;
    const mesh = parseStl(new TextEncoder().encode(ascii).buffer);
    expect(mesh.triangles).toHaveLength(1);
    expect(mesh.triangles[0].a).toEqual([0, 0, 0]);
  });
});

function totalLen(segs: { a: [number, number]; b: [number, number] }[]): number {
  return segs.reduce((s, e) => s + Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), 0);
}

describe("edge selection", () => {
  it("keeps the 12 cube edges, drops the 6 triangulation diagonals", () => {
    const model = buildEdgeModel(cubeMesh());
    // 12 real edges + 6 coplanar face diagonals from triangulation.
    expect(model.edges).toHaveLength(18);
    const basis = cameraBasis(cornerCamera());
    const candidates = selectEdges(model, basis, (80 * Math.PI) / 180);
    expect(candidates).toHaveLength(12);
  });
});

describe("hidden-line occlusion", () => {
  it("hides the 3 far-corner edges (≈1/4 of total length)", () => {
    const mesh = cubeMesh();
    const model = buildEdgeModel(mesh);
    const basis = cameraBasis(cornerCamera());
    const candidates = selectEdges(model, basis, (80 * Math.PI) / 180);
    const minLen = 1e-3;
    const { visible, hidden } = occlude(candidates, mesh.triangles, basis, { removeHidden: true, minLen });
    expect(hidden.length).toBeGreaterThan(0);
    // 9 visible edges vs 3 hidden ⇒ visible ≈ 3× hidden in total length.
    const ratio = totalLen(visible) / totalLen(hidden);
    expect(ratio).toBeGreaterThan(2.4);
    expect(ratio).toBeLessThan(3.6);
  });

  it("keeps all edges visible when hidden removal is off", () => {
    const mesh = cubeMesh();
    const model = buildEdgeModel(mesh);
    const basis = cameraBasis(cornerCamera());
    const candidates = selectEdges(model, basis, (80 * Math.PI) / 180);
    const { visible, hidden } = occlude(candidates, mesh.triangles, basis, { removeHidden: false });
    expect(visible).toHaveLength(12);
    expect(hidden).toHaveLength(0);
  });
});

describe("renderMesh", () => {
  it("produces a single visible layer in remove mode", () => {
    const model = prepareMesh(cubeMesh());
    const res = renderMesh(model, { camera: cornerCamera(), featureAngleDeg: 30, hidden: "remove" });
    expect(res.layers).toHaveLength(1);
    expect(res.layers[0].role).toBe("visible");
    expect(res.layers[0].polylines.length).toBeGreaterThan(0);
    expect(res.bounds).not.toBeNull();
  });

  it("adds a hidden layer in secondColor mode", () => {
    const model = prepareMesh(cubeMesh());
    const res = renderMesh(model, { camera: cornerCamera(), featureAngleDeg: 30, hidden: "secondColor" });
    expect(res.layers.map((l) => l.role)).toEqual(["visible", "hidden"]);
  });

  it("joins each colour into exactly one continuous line when continuous", () => {
    const model = prepareMesh(cubeMesh());
    const multi = renderMesh(model, { camera: cornerCamera(), featureAngleDeg: 30, hidden: "secondColor", continuous: false });
    const one = renderMesh(model, { camera: cornerCamera(), featureAngleDeg: 30, hidden: "secondColor", continuous: true });
    // Without joining a corner view has several segments per layer…
    expect(multi.layers[0].polylines.length).toBeGreaterThan(1);
    // …with continuous on, each layer is a single polyline.
    for (const layer of one.layers) expect(layer.polylines.length).toBe(1);
  });

  it("is deterministic", () => {
    const model = prepareMesh(cubeMesh());
    const opts = { camera: cornerCamera(), featureAngleDeg: 30, hidden: "secondColor" as const };
    expect(JSON.stringify(renderMesh(model, opts))).toBe(JSON.stringify(renderMesh(model, opts)));
  });

  it("fits layers into the plot area preserving aspect", () => {
    const model = prepareMesh(cubeMesh());
    const res = renderMesh(model, { camera: cornerCamera(), featureAngleDeg: 30, hidden: "remove" });
    const fitted = fitLayers(res, 100, 200);
    expect(fitted.width).toBeLessThanOrEqual(100.001);
    expect(fitted.height).toBeLessThanOrEqual(200.001);
    for (const line of fitted.layers[0].polylines) {
      for (const [x, y] of line) {
        expect(x).toBeGreaterThanOrEqual(-0.001);
        expect(y).toBeGreaterThanOrEqual(-0.001);
      }
    }
  });
});
