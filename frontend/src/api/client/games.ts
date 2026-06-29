import { req } from "./req";
import type { MazeResponse, SudokuResponse, ColoringPageResponse, OsmMapRequest, OsmMapResponse, OsmMapGcode, GeocodeResult } from "../types/games";

function osmParams(map: OsmMapRequest) {
  const params = new URLSearchParams({
    south: String(map.south),
    west: String(map.west),
    north: String(map.north),
    east: String(map.east),
    width: String(Math.round(map.width)),
    height: String(Math.round(map.height)),
    detail: String(map.detail),
    include_frame: String(Boolean(map.includeFrame)),
  });
  if (map.areaId != null) params.set("area_id", String(map.areaId));
  return params;
}

function mazeSizeValue(size: string) {
  if (size === "small") return 14;
  if (size === "large") return 26;
  if (size === "huge") return 33;
  if (size === "extreme") return 40;
  return 20;
}

export const gamesClient = {
  getMaze: (type: MazeResponse["type"], seed: number, size: string, width: number, height: number) => {
    const params = new URLSearchParams({ type, seed: String(seed), size: String(mazeSizeValue(size)), width: String(Math.round(width)), height: String(Math.round(height)) });
    return req<MazeResponse>(`/api/maze?${params.toString()}`);
  },
  getSudoku: (difficulty: SudokuResponse["difficulty"], seed: number) => {
    const params = new URLSearchParams({ difficulty, seed: String(seed) });
    return req<SudokuResponse>(`/api/sudoku?${params.toString()}`);
  },
  getColoringPage: (fn: ColoringPageResponse["function"], mode: string, seed: number, width: number, height: number, complexity: number, showSeed: boolean) => {
    const params = new URLSearchParams({ function: fn, mode, seed: String(seed), width: String(Math.round(width)), height: String(Math.round(height)), complexity: String(complexity), show_seed: String(showSeed) });
    return req<ColoringPageResponse>(`/api/coloring-pages?${params.toString()}`);
  },
  getOsmMap: (map: OsmMapRequest) => {
    return req<OsmMapResponse>(`/api/osm-map?${osmParams(map).toString()}`);
  },
  getOsmMapGcode: (map: OsmMapRequest, continuous: boolean) => {
    const params = osmParams(map);
    params.set("continuous", String(continuous));
    return req<OsmMapGcode>(`/api/osm-map/gcode?${params.toString()}`);
  },
  geocodePlace: (q: string) => {
    const params = new URLSearchParams({ q });
    return req<{ results: GeocodeResult[] }>(`/api/geocode?${params.toString()}`);
  },
};
