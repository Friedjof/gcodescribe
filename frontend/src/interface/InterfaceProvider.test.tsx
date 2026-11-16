// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { InterfaceProvider, useInterface } from "./InterfaceProvider";
import { defaultInterfacePreferences, INTERFACE_STORAGE_KEY } from "./preferences";
function Controls() {
  const { preferences, update } = useInterface();
  return <><output>{preferences.theme}:{preferences.experience}:{preferences.density}</output>
    <button onClick={() => update(prefs => ({ ...prefs, theme: "dark", density: "compact", experience: "full" }))}>Change</button></>;
}
beforeEach(() => localStorage.clear());
afterEach(cleanup);
it("applies the default light theme to the document and cleans up after unmount", () => {
  const previous = document.documentElement.dataset.theme;
  const view = render(<InterfaceProvider><Controls /></InterfaceProvider>);
  expect(document.documentElement.dataset.theme).toBe("light");
  fireEvent.click(screen.getByText("Change"));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.dataset.density).toBe("compact");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(JSON.parse(localStorage.getItem(INTERFACE_STORAGE_KEY)!).experience).toBe("full");
  view.unmount(); expect(document.documentElement.dataset.theme).toBe(previous);
});
it("refreshes preferences changed by another window", () => {
  render(<InterfaceProvider><Controls /></InterfaceProvider>);
  localStorage.setItem(INTERFACE_STORAGE_KEY, JSON.stringify({ ...defaultInterfacePreferences(), theme: "dark" }));
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: INTERFACE_STORAGE_KEY })));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(screen.getByText("dark:guided:compact")).toBeTruthy();
});
