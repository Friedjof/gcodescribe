// Extract the edges worth drawing from a triangle mesh.
//
// STL stores each facet's vertices independently (no shared indices), so we
// first weld coincident vertices, then build an edge→faces adjacency map. An
// edge is a candidate line when it is a model boundary, a sharp crease (dihedral
// above a threshold), or a silhouette (its two faces disagree on facing the
// camera). Smooth, coplanar shared edges are dropped — that is what keeps a
// tessellated curved surface from turning into a mess of triangle hatching.
import type { CameraBasis } from "./camera";
import { frontFacing } from "./camera";
import type { Mesh, Triangle, Vec3 } from "./types";
import { dot } from "./vec";

export interface MeshEdge {
  a: Vec3;
  b: Vec3;
  /** Indices into the mesh triangle list (1 = boundary, 2 = interior). */
  tris: number[];
  /** Angle between adjacent face normals, radians (π for boundaries). */
  dihedral: number;
}

export interface EdgeModel {
  edges: MeshEdge[];
  triangles: Triangle[];
}

function weldKey(v: Vec3, inv: number): string {
  return `${Math.round(v[0] * inv)}|${Math.round(v[1] * inv)}|${Math.round(v[2] * inv)}`;
}

export function buildEdgeModel(mesh: Mesh): EdgeModel {
  const ext = Math.max(
    mesh.max[0] - mesh.min[0],
    mesh.max[1] - mesh.min[1],
    mesh.max[2] - mesh.min[2],
    1e-6,
  );
  const inv = 1 / (ext * 1e-6); // weld tolerance ≈ 1e-6 of the model size
  const vertIndex = new Map<string, number>();
  const verts: Vec3[] = [];
  const idOf = (v: Vec3): number => {
    const key = weldKey(v, inv);
    let id = vertIndex.get(key);
    if (id === undefined) {
      id = verts.length;
      vertIndex.set(key, id);
      verts.push(v);
    }
    return id;
  };

  const edgeMap = new Map<string, MeshEdge>();
  mesh.triangles.forEach((t, ti) => {
    const ids = [idOf(t.a), idOf(t.b), idOf(t.c)];
    for (let e = 0; e < 3; e++) {
      const i = ids[e];
      const j = ids[(e + 1) % 3];
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const key = `${lo}-${hi}`;
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = { a: verts[lo], b: verts[hi], tris: [], dihedral: Math.PI };
        edgeMap.set(key, edge);
      }
      edge.tris.push(ti);
    }
  });

  for (const edge of edgeMap.values()) {
    if (edge.tris.length >= 2) {
      const n1 = mesh.triangles[edge.tris[0]].n;
      const n2 = mesh.triangles[edge.tris[1]].n;
      edge.dihedral = Math.acos(Math.max(-1, Math.min(1, dot(n1, n2))));
    }
  }

  return { edges: [...edgeMap.values()], triangles: mesh.triangles };
}

export interface Candidate {
  a: Vec3;
  b: Vec3;
  /** At least one adjacent face points toward the camera. */
  front: boolean;
}

/**
 * Pick the edges to draw for a given camera.
 *
 * @param featureAngle creases at or above this dihedral (radians) are drawn.
 */
export function selectEdges(model: EdgeModel, basis: CameraBasis, featureAngle: number): Candidate[] {
  const out: Candidate[] = [];
  for (const edge of model.edges) {
    const facing = edge.tris.map((ti) => {
      const t = model.triangles[ti];
      return frontFacing(t.n, t.a, basis);
    });
    const anyFront = facing.some(Boolean);
    let draw = false;
    if (edge.tris.length === 1) {
      draw = true; // open boundary
    } else if (edge.dihedral >= featureAngle) {
      draw = true; // sharp crease
    } else if (facing[0] !== facing[1]) {
      draw = true; // silhouette
    }
    if (draw) out.push({ a: edge.a, b: edge.b, front: anyFront });
  }
  return out;
}
