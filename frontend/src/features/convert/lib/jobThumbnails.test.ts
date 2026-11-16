import { expect, it, vi } from "vitest";
import {
  compileJobThumbnail,
  JobThumbnailCache,
  jobThumbnailKey,
} from "./jobThumbnails";
import type { GcodePreview } from "../../../api";
const preview: GcodePreview = {
  polylines: [
    [
      [0, 0],
      [100, 100],
    ],
  ],
  travels: [],
  bounds: [0, 0, 100, 100],
  truncated: false,
};
it("deduplicates thumbnail loading across list and tile mounts", async () => {
  const read = vi.fn(async () => preview),
    cache = new JobThumbnailCache(read),
    job = { filename: "a.gcode", created: 1, size: 100 };
  const [one, two] = await Promise.all([cache.get(job), cache.get(job)]);
  expect(one).toBe(two);
  await cache.get(job);
  expect(read).toHaveBeenCalledOnce();
  await cache.get({ ...job, created: 2 });
  expect(read).toHaveBeenCalledTimes(2);
});
it("bounds parallel preview requests and cached path memory", async () => {
  let resolve!: (p: GcodePreview) => void;
  const read = vi.fn(
    () =>
      new Promise<GcodePreview>((done) => {
        resolve = done;
      }),
  );
  const cache = new JobThumbnailCache(read, 1, 1),
    one = { filename: "a", created: 1, size: 1 },
    two = { ...one, filename: "b" };
  const first = cache.get(one),
    second = cache.get(two);
  expect(read).toHaveBeenCalledOnce();
  resolve(preview);
  await first;
  await new Promise((done) => setTimeout(done, 0));
  expect(read).toHaveBeenCalledTimes(2);
  resolve(preview);
  await second;
  expect(cache.peek(jobThumbnailKey(one))).toBeUndefined();
  expect(cache.peek(jobThumbnailKey(two))).toBeTruthy();
});
it("compiles dense geometry into bounded thumbnail paths while retaining full preview data", () => {
  const dense = {
    ...preview,
    polylines: [
      Array.from({ length: 60000 }, (_, i) => [i / 600, Math.sin(i / 600)]),
    ],
  };
  const thumbnail = compileJobThumbnail(dense)!;
  expect(thumbnail.draw.length).toBeLessThan(70000);
  expect(dense.polylines[0]).toHaveLength(60000);
  expect(
    compileJobThumbnail({ ...preview, polylines: [], bounds: null }),
  ).toBeNull();
});
