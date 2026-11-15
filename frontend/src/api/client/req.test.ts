import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorMessage } from "../errors";
import { req, reqArrayBuffer, reqBlob } from "./req";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP error contract", () => {
  it.each([req, reqBlob, reqArrayBuffer])("preserves service errors for JSON and binary requests", async request => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Please home first" }), { status: 409 })));
    try {
      await request("/api/test-service-error");
      expect.fail("request should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 409, message: "Please home first", name: "ApiError" });
    }
  });

  it("formats FastAPI validation errors without displaying their submitted input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: [
      { loc: ["body", "serial_baud"], msg: "Input should be a valid integer", input: "private-value" },
      { loc: ["body", "axes", 0], msg: "Invalid axis" },
    ] }), { status: 422 })));
    await expect(req("/api/test-validation")).rejects.toMatchObject({
      status: 422,
      message: "body.serial_baud: Input should be a valid integer; body.axes.0: Invalid axis",
    });
  });

  it.each(["not JSON", JSON.stringify({ detail: { input: "private-value" } }), JSON.stringify({}), ""])(
    "falls back to the HTTP status for malformed/unknown error bodies", async body => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 502 })));
      await expect(req("/api/test-malformed-error")).rejects.toMatchObject({ status: 502, message: "HTTP 502" });
    },
  );

  it("does not retry a failed printer command", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"detail":"Printer unavailable"}', { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(req("/api/printer/jog", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("releases a failed shared read so the next poll can recover", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"detail":"Offline"}', { status: 502 }))
      .mockResolvedValueOnce(new Response('{"configured":true,"online":true}'));
    vi.stubGlobal("fetch", fetch);
    const requests = await Promise.allSettled([req("/api/test-recovery"), req("/api/test-recovery")]);
    expect(requests.map(result => result.status)).toEqual(["rejected", "rejected"]);
    expect(fetch).toHaveBeenCalledOnce();
    await expect(req("/api/test-recovery")).resolves.toEqual({ configured: true, online: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("handles unknown catch values consistently", () => {
    expect(errorMessage(new Error("Network unavailable"))).toBe("Network unavailable");
    expect(errorMessage("Plain failure")).toBe("Plain failure");
    expect(errorMessage(null, "Could not load printer")).toBe("Could not load printer");
    expect(errorMessage({ message: { input: "private-value" } })).toBe("Unknown error");
  });
});
