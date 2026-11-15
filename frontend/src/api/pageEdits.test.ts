// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cachedPage, editState, flushEdits, queueObjects, rememberPage } from "./pageEdits";
import type { Page, SceneObject } from "./types/paint";
const geometry = [[[0, 0], [100, 100]]];
const obj = { id: "image", type: "image", cachedPolylines: geometry, transform: { x: 0, y: 0, scale: 1, rotation: 0 } } as SceneObject;
let count = 0;
const makePage = () => rememberPage({ id: `test-${count++}`, name: "Test", objects: [obj], revision: 0, grid: { step: 10, snap: false } } as Page);
const move = (x: number) => [{ ...obj, transform: { ...obj.transform!, x } }];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("sends only changed fields and does not replace its saved revision with stale React state", async () => {
  const page = makePage();
  const fetcher = vi.fn().mockResolvedValue(response({ revision: 1, modified: 1 }));
  vi.stubGlobal("fetch", fetcher);
  queueObjects(page.id, move(10)); await flushEdits(page.id);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ changes: [{ id: "image", transform: { x: 10 } }], removed: [], revision: 0 });
  expect(fetcher.mock.calls[0][1].body).not.toContain("cachedPolylines");
  rememberPage(page);
  expect(cachedPage(page.id)!.revision).toBe(1);
  expect(cachedPage(page.id)!.objects[0].cachedPolylines).toBe(geometry);
});

it("serializes edits made while a request is in flight", async () => {
  const page = makePage();
  let release!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((r) => { release = r; })).mockResolvedValueOnce(response({ revision: 2, modified: 2 }));
  vi.stubGlobal("fetch", fetcher);
  queueObjects(page.id, move(10)); const saved = flushEdits(page.id);
  queueObjects(page.id, move(20));
  expect(fetcher).toHaveBeenCalledTimes(1);
  release(response({ revision: 1, modified: 1 })); await saved;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).revision).toBe(1);
  expect(cachedPage(page.id)!.objects[0].transform!.x).toBe(20);
  expect(editState(page.id).pending).toBe(false);
});

it("merges a completed background import without losing local transforms", async () => {
  const page = makePage();
  const addition = { ...obj, id: "background" };
  const fetcher = vi.fn().mockResolvedValueOnce(response({ detail: "conflict" }, 409))
    .mockResolvedValueOnce(response({ ...page, revision: 1, objects: [obj, addition] }))
    .mockResolvedValueOnce(response({ revision: 2, modified: 2 }));
  vi.stubGlobal("fetch", fetcher);
  queueObjects(page.id, move(10)); await flushEdits(page.id);
  expect(cachedPage(page.id)!.objects.map((o) => o.id)).toEqual(["image", "background"]);
  expect(cachedPage(page.id)!.objects[0].transform!.x).toBe(10);
});

it("retains local work after network failures and makes same-field conflicts explicit", async () => {
  const page = makePage();
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  queueObjects(page.id, move(10)); await expect(flushEdits(page.id)).rejects.toThrow("offline");
  expect(editState(page.id).pending).toBe(true);
  fetcher.mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response({ ...page, revision: 1, objects: move(30) }));
  await expect(flushEdits(page.id)).rejects.toThrow("save.conflict");
  expect(editState(page.id).conflict).toBe(true);
  expect(cachedPage(page.id)!.objects[0].transform!.x).toBe(10);
  fetcher.mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response({ ...page, revision: 1, objects: move(30) })).mockResolvedValueOnce(response({ revision: 2, modified: 2 }));
  await flushEdits(page.id, true);
  expect(editState(page.id).pending).toBe(false);
});

it("does not turn concurrent additions into deletions after a failed rebase", async () => {
  const page = makePage();
  const remote = { ...page, revision: 1, objects: [obj, { ...obj, id: "added" }] };
  const fetcher = vi.fn().mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response(remote)).mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  queueObjects(page.id, move(10)); await expect(flushEdits(page.id)).rejects.toThrow("offline");
  fetcher.mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response(remote)).mockResolvedValueOnce(response({ revision: 2, modified: 2 }));
  await flushEdits(page.id);
  expect(cachedPage(page.id)!.objects.map((o) => o.id)).toContain("added");
  expect(JSON.parse(fetcher.mock.calls[fetcher.mock.calls.length - 1][1].body).removed).toEqual([]);
});

it("keeps page queues independent when switching pages", async () => {
  const first = makePage(), second = makePage();
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({ revision: 1, modified: 1 })));
  vi.stubGlobal("fetch", fetcher);
  queueObjects(first.id, move(10)); queueObjects(second.id, move(20));
  await Promise.all([flushEdits(first.id), flushEdits(second.id)]);
  expect(cachedPage(first.id)!.objects[0].transform!.x).toBe(10);
  expect(cachedPage(second.id)!.objects[0].transform!.x).toBe(20);
});
