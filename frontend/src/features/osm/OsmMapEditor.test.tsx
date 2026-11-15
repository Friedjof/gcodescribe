// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Calibration, OsmMapResponse } from "../../api";
import OsmMapEditor from "./OsmMapEditor";

const mocks = vi.hoisted(() => ({
  geocodePlace: vi.fn(),
  getOsmMap: vi.fn(),
  getOsmMapGcode: vi.fn(),
  error: vi.fn(),
}));
const t = (key: string) => key;
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t }) }));
vi.mock("../../components/Toasts", () => ({ useToasts: () => ({ error: mocks.error }) }));
vi.mock("../../components/Gcode3DOverlay", () => ({ default: () => null }));

const city = {
  name: "Berlin", lat: 52.5, lon: 13.4,
  south: 52.3, west: 13.0, north: 52.7, east: 13.8,
  osmType: "relation", osmId: 62422, areaId: 3600062422,
};
const map: OsmMapResponse = {
  width: 180, height: 180, viewBox: "0 0 180 180",
  lines: [[[1, 2], [3, 4]]], metadata: { point_count: 2, line_count: 1 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function selectBerlin() {
  fireEvent.change(screen.getByPlaceholderText("games.osm.searchPlaceholder"), { target: { value: "Berlin" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "games.osm.searchButton" })));
  fireEvent.click(screen.getByRole("button", { name: "Berlin" }));
  await act(async () => vi.advanceTimersByTimeAsync(400));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.geocodePlace.mockResolvedValue({ results: [city] });
  mocks.getOsmMapGcode.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function editor() {
  return render(<OsmMapEditor cal={{ plot_width: 180, plot_height: 180 } as Calibration}
    busy={false} onClose={vi.fn()} onInsert={vi.fn()} />);
}

describe("large city preview requests", () => {
  it("starts G-code only after the map preview finishes", async () => {
    const pending = deferred<OsmMapResponse>();
    mocks.getOsmMap.mockReturnValue(pending.promise);
    editor();
    await selectBerlin();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.getOsmMap).toHaveBeenCalledTimes(1);
    expect(mocks.getOsmMapGcode).not.toHaveBeenCalled();
    await act(async () => pending.resolve(map));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(mocks.getOsmMapGcode).toHaveBeenCalledTimes(1);
  });

  it("ignores old responses after changing the detail and aborts on close", async () => {
    const first = deferred<OsmMapResponse>();
    const second = deferred<OsmMapResponse>();
    mocks.getOsmMap.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const rendered = editor();
    await selectBerlin();
    const oldSignal = mocks.getOsmMap.mock.calls[0][1] as AbortSignal;
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(400));
    await act(async () => first.resolve(map));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.getOsmMapGcode).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "games.createPage" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => second.resolve(map));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(mocks.getOsmMapGcode.mock.calls[0][0].detail).toBe(1);
    const signal = mocks.getOsmMapGcode.mock.calls[0][2] as AbortSignal;
    rendered.unmount();
    expect(signal.aborted).toBe(true);
  });
});
