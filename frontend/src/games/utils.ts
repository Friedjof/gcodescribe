import type { Calibration, SceneObject } from "../api";
import { bounds, localize } from "../paint/geometry";
import type { Pt } from "../paint/geometry";
import { gameTextWorld } from "./lettering";
import type { GameId } from "./types";
import { PAGE_MARGIN } from "./constants";

const GEOMETRY_EPS = 1e-6;

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.max(1, Math.floor(Math.random() * 0x7fffffff));
}

export function randomMazeSeed() {
  return 10000 + Math.floor(Math.random() * 90000); // always 5 digits: 10000–99999
}

export function randomInt(rand: () => number, min: number, maxExclusive: number) {
  return Math.floor(rand() * (maxExclusive - min)) + min;
}

export function shuffle<T>(items: T[], rand: () => number) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function formatMm(value: number) {
  return `${value.toFixed(1)} mm`;
}

export function rectOutline(x: number, y: number, width: number, height: number): Pt[] {
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]];
}

export function circle(center: Pt, radius: number, segments = 14): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]);
  }
  return pts;
}

export function mergeAxisAlignedSegments(lines: Pt[][]): Pt[][] {
  const horizontal = new Map<string, Array<[number, number, number]>>();
  const vertical = new Map<string, Array<[number, number, number]>>();
  const other: Pt[][] = [];
  const key = (value: number) => value.toFixed(6);

  for (const line of lines) {
    if (line.length !== 2) { other.push(line); continue; }
    const [[x1, y1], [x2, y2]] = line;
    if (y1 === y2) {
      const group = horizontal.get(key(y1)) ?? [];
      group.push([Math.min(x1, x2), Math.max(x1, x2), y1]);
      horizontal.set(key(y1), group);
    } else if (x1 === x2) {
      const group = vertical.get(key(x1)) ?? [];
      group.push([Math.min(y1, y2), Math.max(y1, y2), x1]);
      vertical.set(key(x1), group);
    } else {
      other.push(line);
    }
  }

  const merged: Pt[][] = [...other];
  for (const segments of horizontal.values()) {
    segments.sort((a, b) => a[2] - b[2] || a[0] - b[0]);
    for (const [start, end, y] of mergeIntervals(segments)) {
      merged.push([[start, y], [end, y]]);
    }
  }
  for (const segments of vertical.values()) {
    segments.sort((a, b) => a[2] - b[2] || a[0] - b[0]);
    for (const [start, end, x] of mergeIntervals(segments)) {
      merged.push([[x, start], [x, end]]);
    }
  }
  return merged;
}

function mergeIntervals(segments: Array<[number, number, number]>): Array<[number, number, number]> {
  const merged: Array<[number, number, number]> = [];
  for (const [start, end, axis] of segments) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + GEOMETRY_EPS) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end, axis]);
    }
  }
  return merged;
}

export function centerText(text: string, center: Pt, height: number, maxWidth?: number): Pt[][] {
  let { local } = localize(gameTextWorld(text, [0, 0], height));
  if (maxWidth) {
    const box = bounds(local.flat());
    const width = box[2] - box[0];
    if (width > maxWidth && width > 0) {
      const scale = maxWidth / width;
      local = local.map((line) => line.map(([x, y]) => [x * scale, y * scale] as Pt));
    }
  }
  return local.map((line) => line.map(([x, y]) => [x + center[0], y + center[1]] as Pt));
}

export function usableArea(cal: Calibration) {
  return {
    width: Math.max(cal.plot_width - PAGE_MARGIN * 2, 20),
    height: Math.max(cal.plot_height - PAGE_MARGIN * 2, 20),
  };
}

export function centeredOrigin(
  width: number,
  height: number,
  cal: Calibration,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Pt {
  const { width: usableWidth, height: usableHeight } = usableArea(cal);
  if (width > usableWidth || height > usableHeight) {
    throw new Error(t("games.errorTooLarge", {
      width: width.toFixed(0),
      height: height.toFixed(0),
      plotW: usableWidth.toFixed(0),
      plotH: usableHeight.toFixed(0),
    }));
  }
  return [(cal.plot_width - width) / 2, (cal.plot_height - height) / 2];
}

export function templateObject(gameId: GameId, lines: Pt[][]): SceneObject {
  const { local, cx, cy } = localize(lines);
  return {
    id: crypto.randomUUID(),
    type: `game-${gameId}`,
    data: { template: gameId },
    cachedPolylines: local,
    transform: { x: cx, y: cy, rotation: 0, scale: 1 },
    plotted: false,
  };
}
