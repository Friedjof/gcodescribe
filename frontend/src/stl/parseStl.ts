// Self-contained STL parser (binary + ASCII), no external dependencies so the
// geometry core stays unit-testable in node.
import type { Mesh, Triangle, Vec3 } from "./types";
import { faceNormal } from "./vec";

const EMPTY_MIN: Vec3 = [Infinity, Infinity, Infinity];
const EMPTY_MAX: Vec3 = [-Infinity, -Infinity, -Infinity];

function meshFrom(triangles: Triangle[]): Mesh {
  const min: Vec3 = [...EMPTY_MIN];
  const max: Vec3 = [...EMPTY_MAX];
  for (const t of triangles) {
    for (const v of [t.a, t.b, t.c]) {
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    }
  }
  return { triangles, min, max };
}

/** A normal that is zero/absent in the file is recomputed from the geometry. */
function withNormal(a: Vec3, b: Vec3, c: Vec3, n: Vec3): Triangle {
  const ok = Number.isFinite(n[0]) && n[0] * n[0] + n[1] * n[1] + n[2] * n[2] > 1e-10;
  return { a, b, c, n: ok ? n : faceNormal(a, b, c) };
}

/** Binary STL detection: ASCII files start with "solid" and contain no NULs in
 *  the header region; binary files are exactly 84 + 50·count bytes. */
function looksBinary(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return false;
  const view = new DataView(buf);
  const count = view.getUint32(80, true);
  if (buf.byteLength === 84 + count * 50) return true;
  // Fallback: if the first bytes aren't "solid", treat as binary.
  const head = new Uint8Array(buf, 0, 5);
  const txt = String.fromCharCode(...head).toLowerCase();
  return txt !== "solid";
}

function parseBinary(buf: ArrayBuffer): Mesh {
  const view = new DataView(buf);
  const count = view.getUint32(80, true);
  const triangles: Triangle[] = [];
  let off = 84;
  for (let i = 0; i < count && off + 50 <= buf.byteLength; i++, off += 50) {
    const n: Vec3 = [view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true)];
    const a: Vec3 = [view.getFloat32(off + 12, true), view.getFloat32(off + 16, true), view.getFloat32(off + 20, true)];
    const b: Vec3 = [view.getFloat32(off + 24, true), view.getFloat32(off + 28, true), view.getFloat32(off + 32, true)];
    const c: Vec3 = [view.getFloat32(off + 36, true), view.getFloat32(off + 40, true), view.getFloat32(off + 44, true)];
    triangles.push(withNormal(a, b, c, n));
  }
  return meshFrom(triangles);
}

function parseAscii(text: string): Mesh {
  const triangles: Triangle[] = [];
  // Tokenise on whitespace; walk facet/vertex keywords.
  const tok = text.split(/\s+/);
  let normal: Vec3 = [0, 0, 0];
  const verts: Vec3[] = [];
  for (let i = 0; i < tok.length; i++) {
    const word = tok[i];
    if (word === "facet" && tok[i + 1] === "normal") {
      normal = [parseFloat(tok[i + 2]), parseFloat(tok[i + 3]), parseFloat(tok[i + 4])];
      i += 4;
    } else if (word === "vertex") {
      verts.push([parseFloat(tok[i + 1]), parseFloat(tok[i + 2]), parseFloat(tok[i + 3])]);
      i += 3;
    } else if (word === "endfacet") {
      if (verts.length >= 3) triangles.push(withNormal(verts[0], verts[1], verts[2], normal));
      verts.length = 0;
    }
  }
  return meshFrom(triangles);
}

export function parseStl(input: ArrayBuffer): Mesh {
  if (looksBinary(input)) return parseBinary(input);
  return parseAscii(new TextDecoder().decode(input));
}
