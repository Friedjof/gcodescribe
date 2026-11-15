import { cachedGeometryPath, cacheGeometryPath, cacheGeometryHull, toMultiPath, type Pt, type Transform } from "./geometry";
import { packLines } from "./geometryTransfer";
import type { VectorStyle } from "./styling";

export type GeometryRequest =
  | { kind: "path"; lines: Pt[][] }
  | { kind: "style"; lines: Pt[][]; style: VectorStyle }
  | { kind: "raster"; lines: Pt[][]; stroke: number }
  | { kind: "erase"; lines: Pt[][]; path: Pt[]; mode: "free" | "line"; radius: number; transform?: Transform; preview?: boolean };
let worker: Worker | null = null;
let serial = 0;
type Job = { id: number; request: GeometryRequest; key?: string; resolve: (value: any) => void; reject: (error: Error) => void };
const pending = new Map<number, Job>();
const queued: Job[] = [];
let working = false;
function dispatch() {
  if (working || !worker) return;
  const job = queued.shift();
  if (!job) return;
  working = true;
  const packed = packLines(job.request.lines);
  worker.postMessage({ id: job.id, request: { ...job.request, lines: undefined, packed } }, [packed.lengths.buffer, packed.points.buffer]);
}
const paths = new WeakMap<Pt[][], Promise<string>>();
const previews = new WeakMap<Pt[][], string>();

export async function geometryTask<T>(request: GeometryRequest, key?: string): Promise<T> {
  if (typeof Worker === "undefined") {
    const { computeGeometry } = await import("./geometryWork");
    return computeGeometry(request) as T;
  }
  if (!worker) {
    worker = new Worker(new URL("./geometry.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      pending.delete(data.id); working = false;
      if (data.error) job?.reject(new Error(data.error)); else job?.resolve(data.result);
      dispatch();
    };
    worker.onerror = () => {
      for (const job of pending.values()) job.reject(new Error("Geometry worker failed"));
      pending.clear(); queued.length = 0; working = false; worker?.terminate(); worker = null;
    };
  }
  const id = ++serial;
  return new Promise<T>((resolve, reject) => {
    if (key) {
      const index = queued.findIndex((job) => job.key === key);
      if (index >= 0) {
        const previous = queued.splice(index, 1)[0]; pending.delete(previous.id);
        previous.reject(new DOMException("Superseded", "AbortError"));
      }
    }
    const job = { id, request, key, resolve, reject };
    pending.set(id, job); queued.push(job); dispatch();
  });
}

export function preparePath(lines: Pt[][]): Promise<string> {
  const cached = cachedGeometryPath(lines);
  if (cached !== undefined) return Promise.resolve(cached);
  let job = paths.get(lines);
  if (!job) {
    job = geometryTask<{ path: string; hull: Pt[] }>({ kind: "path", lines }).then(({ path, hull }) => {
      cacheGeometryPath(lines, path); cacheGeometryHull(lines, hull); paths.delete(lines); return path;
    }, (error) => { paths.delete(lines); throw error; });
    paths.set(lines, job);
  }
  return job;
}

/** Display-only sample, bounded even when an image contains thousands of short strokes. */
export function previewPath(lines: Pt[][]): string {
  let result = previews.get(lines);
  if (result !== undefined) return result;
  const points = lines.reduce((sum, line) => sum + line.length, 0);
  if (points <= 4000) return toMultiPath(lines);
  const sampled: Pt[][] = [];
  const lineStep = Math.max(1, Math.ceil(lines.length / 1000));
  let selectedPoints = 0;
  for (let i = 0; i < lines.length; i += lineStep) selectedPoints += lines[i].length;
  const pointStep = Math.max(1, Math.ceil(selectedPoints / 3000));
  for (let i = 0; i < lines.length; i += lineStep) {
    const line = lines[i];
    if (!line.length) continue;
    const selected: Pt[] = [];
    for (let p = 0; p < line.length; p += pointStep) selected.push(line[p]);
    if (selected[selected.length - 1] !== line[line.length - 1]) selected.push(line[line.length - 1]);
    sampled.push(selected);
  }
  result = toMultiPath(sampled); previews.set(lines, result); return result;
}
