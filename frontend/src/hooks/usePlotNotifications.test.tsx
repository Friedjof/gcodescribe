// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePlotNotifications } from "./usePlotNotifications";

const mocks = vi.hoisted(() => ({ success: vi.fn(), warn: vi.fn(), show: vi.fn(), request: vi.fn() }));
vi.mock("../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../components/Toasts", () => ({ useToasts: () => ({ success: mocks.success, warn: mocks.warn }) }));
class TestNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = mocks.request;
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(title: string, options: NotificationOptions) { mocks.show(title, options); }
}
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  TestNotification.permission = "default";
  vi.stubGlobal("Notification", TestNotification);
  vi.stubGlobal("isSecureContext", true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("requests permission and immediately sends an observable test notification", async () => {
  mocks.request.mockImplementation(async () => { TestNotification.permission = "granted"; return "granted"; });
  const { result } = renderHook(() => usePlotNotifications(null));
  await act(() => result.current.request());
  expect(result.current.active).toBe(true);
  expect(mocks.show).toHaveBeenCalledWith("notify.title", { body: "notify.testBody", tag: "gcodescribe-test" });
  expect(mocks.success).toHaveBeenCalledWith("notify.testSent");
});
it("handles rejected permission requests and notification constructors without crashing", async () => {
  mocks.request.mockRejectedValue(new Error("denied"));
  const { result } = renderHook(() => usePlotNotifications(null));
  await act(() => result.current.request());
  expect(mocks.warn).toHaveBeenCalledWith("notify.failed");
  TestNotification.permission = "granted";
  mocks.show.mockImplementation(() => { throw new Error("platform unavailable"); });
  act(() => result.current.test());
  expect(mocks.warn).toHaveBeenCalledTimes(2);
  expect(mocks.success).not.toHaveBeenCalled();
});
it("explains the secure-origin requirement instead of requesting unusable permission", async () => {
  vi.stubGlobal("isSecureContext", false);
  const { result } = renderHook(() => usePlotNotifications(null));
  expect(result.current.permission).toBe("unsupported");
  await act(() => result.current.request());
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.warn).toHaveBeenCalledWith("notify.secureRequired");
});
it("refreshes externally changed permissions when the app regains focus", () => {
  const { result } = renderHook(() => usePlotNotifications(null));
  TestNotification.permission = "granted";
  act(() => window.dispatchEvent(new Event("focus")));
  expect(result.current.active).toBe(true);
  TestNotification.permission = "denied";
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(result.current.active).toBe(false);
});
