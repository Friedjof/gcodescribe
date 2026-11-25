import { afterEach, expect, it, vi } from "vitest";
import { DISPLAY_INK_COLOR } from "../../../lib/displayStroke";
import { packLines } from "./geometryTransfer";

afterEach(() => vi.unstubAllGlobals());
it("encodes dark ink in the PNG instead of relying on a theme-dependent image filter", async () => {
  const context = {
    scale: vi.fn(), translate: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "",
  };
  const convert = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])]));
  const post = vi.fn();
  const sizes: number[][] = [];
  const scope = { postMessage: post, onmessage: undefined as undefined | ((event: unknown) => Promise<void>) };
  vi.stubGlobal("self", scope);
  vi.stubGlobal("OffscreenCanvas", class {
    constructor(public width: number, public height: number) { sizes.push([width, height]); }
    getContext() { return context; }
    convertToBlob = convert;
  });
  await import("./geometry.worker");
  await scope.onmessage!({ data: { id: 7, request: { kind: "raster", stroke: .3, packed: packLines([[[0, 0], [10, 10]]]) } } });
  expect(context.strokeStyle).toBe(DISPLAY_INK_COLOR);
  expect(context.strokeStyle).toBe("#171a20");
  expect(context.stroke).toHaveBeenCalledOnce();
  expect(convert).toHaveBeenCalledWith({ type: "image/png" });
  expect(new Uint8Array(post.mock.calls[0][0].result)).toEqual(new Uint8Array([1, 2, 3]));
  expect(post.mock.calls[0][1].transfer).toEqual([post.mock.calls[0][0].result]);
  await scope.onmessage!({ data: { id: 8, request: { kind: "raster", stroke: .001, packed: packLines([[[0, 0], [10000, 10000]]]) } } });
  expect(Math.max(...sizes.flat())).toBe(2048);
});
