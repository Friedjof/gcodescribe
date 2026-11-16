import type { GcodePreview, Job } from "../../../api";
export interface JobThumbnail {
  viewBox: string;
  draw: string;
  travel: string;
  stroke: number;
}
export const jobThumbnailKey = (
  job: Pick<Job, "filename" | "created" | "size">,
) => JSON.stringify([job.filename, job.created, job.size]);
function path(lines: number[][][], maxPoints = 2400): string {
  const lineStep = Math.max(1, Math.ceil(lines.length / 600));
  const chosen = lines.filter((_, index) => index % lineStep === 0);
  const count = chosen.reduce((sum, line) => sum + line.length, 0),
    step = Math.max(1, Math.ceil(count / maxPoints));
  return chosen
    .map((line) => {
      if (line.length < 2) return "";
      const points = line.filter(
        (_, index) =>
          index === 0 || index === line.length - 1 || index % step === 0,
      );
      return (
        "M" +
        points
          .map(([x, y]) => `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`)
          .join("L")
      );
    })
    .join("");
}
export function compileJobThumbnail(
  preview: GcodePreview,
): JobThumbnail | null {
  let bounds = preview.bounds;
  if (!bounds || !bounds.every(Number.isFinite)) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const lines of [preview.polylines, preview.travels])
      for (const line of lines)
        for (const [x, y] of line) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    if (!Number.isFinite(x0)) return null;
    bounds = [x0, y0, x1, y1];
  }
  const [x0, y0, x1, y1] = bounds,
    w = Math.max(1, x1 - x0),
    h = Math.max(1, y1 - y0),
    pad = Math.max(w, h) * 0.05;
  return {
    viewBox: `${x0 - pad} ${y0 - pad} ${w + 2 * pad} ${h + 2 * pad}`,
    draw: path(preview.polylines),
    travel: path(preview.travels, 1000),
    stroke: Math.max(w, h) / 180,
  };
}
/** Deduplicated, bounded thumbnail work survives view switches without retaining full G-code. */
export class JobThumbnailCache {
  private values = new Map<string, JobThumbnail | null>();
  private pending = new Map<string, Promise<JobThumbnail | null>>();
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(
    private read: (filename: string) => Promise<GcodePreview>,
    private capacity = 100,
    private concurrency = 2,
  ) {}
  peek(key: string) {
    return this.values.get(key);
  }
  get(
    job: Pick<Job, "filename" | "created" | "size">,
  ): Promise<JobThumbnail | null> {
    const key = jobThumbnailKey(job);
    if (this.values.has(key)) {
      const result = this.values.get(key)!;
      this.values.delete(key);
      this.values.set(key, result);
      return Promise.resolve(result);
    }
    const current = this.pending.get(key);
    if (current) return current;
    const promise = new Promise<JobThumbnail | null>((resolve, reject) => {
      this.queue.push(() => {
        this.active++;
        this.read(job.filename)
          .then(compileJobThumbnail)
          .then((value) => {
            this.values.set(key, value);
            while (this.values.size > this.capacity)
              this.values.delete(this.values.keys().next().value!);
            resolve(value);
          }, reject)
          .finally(() => {
            this.pending.delete(key);
            this.active--;
            this.pump();
          });
      });
    });
    this.pending.set(key, promise);
    this.pump();
    return promise;
  }
  private pump() {
    while (this.active < this.concurrency && this.queue.length)
      this.queue.shift()!();
  }
}
