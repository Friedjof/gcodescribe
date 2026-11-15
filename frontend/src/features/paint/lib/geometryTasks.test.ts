import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_VECTOR_STYLE } from "./styling";
afterEach(() => vi.unstubAllGlobals());
it("keeps one worker request in flight and coalesces superseded style updates", async () => {
  vi.resetModules();
  let instance: any;
  const sent: any[] = [];
  vi.stubGlobal("Worker", class {
    onmessage?: (event: any) => void; onerror?: () => void;
    constructor() { instance = this; }
    postMessage(message: any) { sent.push(message); }
    terminate() {}
  });
  const { geometryTask } = await import("./geometryTasks");
  const request = { kind: "style" as const, lines: [[[0, 0], [1, 1]]] as [number, number][][], style: DEFAULT_VECTOR_STYLE };
  const first = geometryTask(request, "first");
  const second = geometryTask(request, "same-object").catch((e) => e.name);
  const third = geometryTask(request, "same-object");
  expect(sent).toHaveLength(1);
  expect(await second).toBe("AbortError");
  instance.onmessage({ data: { id: sent[0].id, result: [] } });
  await first;
  expect(sent).toHaveLength(2);
  instance.onmessage({ data: { id: sent[1].id, result: [] } });
  await third;
});
