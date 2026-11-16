// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useJobPreview } from "./useJobPreview";
const api = vi.hoisted(() => ({ jobPreview3D: vi.fn() }));
vi.mock("../../../api", () => ({ api }));
it("ignores a late reply after close and never replaces a newer job", async () => {
 const pending: ((value: unknown) => void)[] = [];
 api.jobPreview3D.mockImplementation(() => new Promise((done) => pending.push(done)));
 const error = vi.fn(); const { result, rerender } = renderHook(({ visible }) => useJobPreview(visible, error), { initialProps: { visible: true } });
 act(() => result.current.open("first.gcode")); const firstSignal = api.jobPreview3D.mock.calls[0][1] as AbortSignal;
 act(() => result.current.close()); expect(firstSignal.aborted).toBe(true);
 await act(async () => pending[0]({})); expect(result.current.preview).toBeUndefined();
 act(() => result.current.open("second.gcode")); act(() => result.current.open("third.gcode"));
 await act(async () => pending[1]({ old: true })); expect(result.current.preview?.name).toBe("third.gcode");
 rerender({ visible: false }); expect(result.current.preview).toBeUndefined();
 expect((api.jobPreview3D.mock.calls[2][1] as AbortSignal).aborted).toBe(true);
 expect(error).not.toHaveBeenCalled();
});
