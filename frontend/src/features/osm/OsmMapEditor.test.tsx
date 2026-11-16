// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Calibration, OsmMapResponse } from "../../api";
import OsmMapEditor from "./OsmMapEditor";
const mocks = vi.hoisted(() => ({ geocodePlace: vi.fn(), getOsmMap: vi.fn(), getOsmMapGcode: vi.fn() }));
const t = (key: string) => key;
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t }) }));
vi.mock("../../components/Gcode3DOverlay", () => ({ default: () => <div data-testid="gcode-overlay"/> }));
const city = { name: "Berlin", lat: 52.5, lon: 13.4, south: 52.3, west: 13, north: 52.7, east: 13.8, osmType: "relation", osmId: 62422, areaId: 3600062422 };
const map: OsmMapResponse = { width: 180, height: 180, viewBox: "0 0 180 180", lines: [[[1,2],[3,4]]], metadata: { point_count: 2, line_count: 1 } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function selectBerlin() {
  fireEvent.change(screen.getByPlaceholderText("games.osm.searchPlaceholder"), { target: { value: "Berlin" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "games.osm.searchButton" })));
  fireEvent.click(screen.getByRole("button", { name: "Berlin" }));
  await act(async () => vi.advanceTimersByTimeAsync(250));
}
function drawing() { fireEvent.click(screen.getByRole("tab", { name: "games.osm.tab.drawing" })); }
beforeEach(() => { vi.useFakeTimers(); Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.geocodePlace.mockResolvedValue({ results: [city] }); mocks.getOsmMap.mockResolvedValue(map); mocks.getOsmMapGcode.mockReturnValue(new Promise(() => {})); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function editor(onInsert = vi.fn()) { return render(<OsmMapEditor cal={{ plot_width: 180, plot_height: 180 } as Calibration} busy={false} onInsert={onInsert}/>); }
describe("inline OSM workspace", () => {
  it("updates without a modal and calculates the expensive route only on request", async () => {
    editor(); await selectBerlin();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.getOsmMap).toHaveBeenCalledTimes(1);
    expect(mocks.getOsmMapGcode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "games.osm.gcode3d" }));
    expect(mocks.getOsmMapGcode).toHaveBeenCalledTimes(1);
  });
  it("keeps the last map visible, rejects stale results, and aborts the route on close", async () => {
    const second = deferred<OsmMapResponse>(); const third = deferred<OsmMapResponse>();
    const insert = vi.fn(); const rendered = editor(insert); await selectBerlin();
    mocks.getOsmMap.mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    drawing(); fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    expect(document.querySelector(".games-preview svg")).not.toBeNull();
    expect((screen.getByRole("button", { name: "games.createPage" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(250));
    const oldSignal = mocks.getOsmMap.mock.calls[1][1] as AbortSignal;
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.8" } });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(250));
    await act(async () => second.resolve(map));
    expect((screen.getByRole("button", { name: "games.createPage" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => third.resolve(map));
    fireEvent.click(screen.getByRole("button", { name: "games.createPage" })); expect(insert).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "games.osm.gcode3d" }));
    expect(mocks.getOsmMapGcode.mock.calls[0][0].detail).toBe(0.8);
    const signal = mocks.getOsmMapGcode.mock.calls[0][2] as AbortSignal; rendered.unmount(); expect(signal.aborted).toBe(true);
  });
  it("reuses a recent map when returning to previous settings", async () => {
    editor(); await selectBerlin(); drawing();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.55" } });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(mocks.getOsmMap).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("button", { name: "games.createPage" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("retries a failed map request without clearing the selected place", async () => {
    mocks.getOsmMap.mockRejectedValueOnce(new Error("Network unavailable"));
    editor(); await selectBerlin();
    expect(screen.getByRole("alert").textContent).toContain("Network unavailable");
    fireEvent.click(screen.getByRole("button", { name: "common.refresh" }));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(mocks.getOsmMap).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not allow a late place search to replace newer results", async () => {
    const first = deferred<{ results: typeof city[] }>(); mocks.geocodePlace.mockReturnValueOnce(first.promise);
    editor(); const input = screen.getByPlaceholderText("games.osm.searchPlaceholder");
    fireEvent.change(input, { target: { value: "old search" } }); fireEvent.click(screen.getByRole("button", { name: "games.osm.searchButton" }));
    const signal = mocks.geocodePlace.mock.calls[0][1] as AbortSignal;
    fireEvent.change(input, { target: { value: "Berlin" } });
    expect(signal.aborted).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "games.osm.searchButton" })));
    await act(async () => first.resolve({ results: [{...city, name: "Old result"}] }));
    expect(screen.getByRole("button", { name: "Berlin" })).toBeDefined(); expect(screen.queryByRole("button", { name: "Old result" })).toBeNull();
  });
});
