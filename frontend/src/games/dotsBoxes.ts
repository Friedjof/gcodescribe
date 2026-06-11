import type { Calibration } from "../api";
import type { Pt } from "../paint/geometry";
import type { DotsDensity, DotsJitter, DotsPlayable, TemplateSpec, Translator } from "./types";
import { clamp, formatMm, circle, usableArea, centeredOrigin, mulberry32 } from "./utils";

// ─── Cell encoding ─────────────────────────────────────────────────────────────
// A cell (col, row) is encoded as col + row * STRIDE.
// STRIDE must be > max col dimension used (cols ≤ 28, so 64 is safe).
const STRIDE = 64;
const enc  = (c: number, r: number): number => c + r * STRIDE;
const decC = (n: number): number => n % STRIDE;
const decR = (n: number): number => Math.floor(n / STRIDE);

function nbrs(n: number, cols: number, rows: number): number[] {
  const c = decC(n), r = decR(n);
  const out: number[] = [];
  if (c + 1 < cols) out.push(enc(c + 1, r));
  if (c > 0)        out.push(enc(c - 1, r));
  if (r + 1 < rows) out.push(enc(c, r + 1));
  if (r > 0)        out.push(enc(c, r - 1));
  return out;
}

// ─── Connectivity ──────────────────────────────────────────────────────────────
function largestComponent(cells: Set<number>, cols: number, rows: number): Set<number> {
  const seen = new Set<number>();
  let best = new Set<number>();
  for (const start of cells) {
    if (seen.has(start)) continue;
    const comp = new Set<number>();
    const q: number[] = [start];
    seen.add(start);
    for (let qi = 0; qi < q.length; qi++) {
      const n = q[qi];
      comp.add(n);
      for (const nb of nbrs(n, cols, rows))
        if (cells.has(nb) && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
    if (comp.size > best.size) best = comp;
  }
  return best;
}

function isConnected(cells: Set<number>, cols: number, rows: number): boolean {
  return largestComponent(cells, cols, rows).size === cells.size;
}

// ─── Random walk helper ────────────────────────────────────────────────────────
function walkOffsets(count: number, max: number, rand: () => number): number[] {
  if (max <= 0) return new Array(count).fill(0);
  let v = Math.floor(rand() * (max + 1));
  return Array.from({ length: count }, () => {
    v = Math.max(0, Math.min(max, v + ([-1, 0, 0, 1] as const)[Math.floor(rand() * 4)]));
    return v;
  });
}

// ─── Outer shape ───────────────────────────────────────────────────────────────
// Carves an organic border using four independent random walks (top/bottom/left/right).
function outerShape(cols: number, rows: number, jitter: number, rand: () => number): Set<number> {
  jitter = clamp(jitter, 0, Math.floor(Math.min(cols, rows) / 4));
  const bot = walkOffsets(cols, jitter, rand);
  const top = walkOffsets(cols, jitter, rand);
  const lft = walkOffsets(rows, jitter, rand);
  const rgt = walkOffsets(rows, jitter, rand);
  const cells = new Set<number>();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (bot[c] <= r && r < rows - top[c] && lft[r] <= c && c < cols - rgt[r])
        cells.add(enc(c, r));
  return largestComponent(cells, cols, rows);
}

// ─── Blob growth ──────────────────────────────────────────────────────────────
// Grows a random connected blob of up to `size` cells within `allowed`.
function growBlob(
  start: number, allowed: Set<number>, size: number,
  cols: number, rows: number, rand: () => number,
): Set<number> {
  const blob = new Set<number>([start]);
  const front: number[] = [start];
  while (front.length > 0 && blob.size < size) {
    const fi    = Math.floor(rand() * front.length);
    const cur   = front[fi];
    const cands = nbrs(cur, cols, rows).filter(nb => allowed.has(nb) && !blob.has(nb));
    if (!cands.length) { front.splice(fi, 1); continue; }
    const nx = cands[Math.floor(rand() * cands.length)];
    blob.add(nx); front.push(nx);
  }
  return blob;
}

// ─── Inner islands ─────────────────────────────────────────────────────────────
// Repeatedly carves interior blobs to bring playable count down towards `target`.
function carveIslands(
  playable: Set<number>, cols: number, rows: number,
  target: number, minSz: number, maxSz: number,
  rand: () => number,
): Set<number> {
  if (target >= playable.size) return playable;
  playable = new Set(playable);
  for (let attempt = 0; attempt < 8000 && playable.size > target; attempt++) {
    const interior = [...playable].filter(n => {
      const c = decC(n), r = decR(n);
      return c >= 1 && c < cols - 1 && r >= 1 && r < rows - 1;
    });
    if (!interior.length) break;
    const sz = Math.min(minSz + Math.floor(rand() * (maxSz - minSz + 1)), playable.size - target);
    if (sz <= 0) break;
    const start  = interior[Math.floor(rand() * interior.length)];
    const island = growBlob(start, new Set(interior), sz, cols, rows, rand);
    if (island.size < minSz && playable.size - island.size > target) continue;
    const rest = new Set([...playable].filter(n => !island.has(n)));
    if (rest.size < target || !isConnected(rest, cols, rows)) continue;
    // Island must stay in contact with the surrounding playable area.
    let contacts = 0;
    for (const n of island)
      for (const nb of nbrs(n, cols, rows))
        if (rest.has(nb)) contacts++;
    if (contacts < Math.max(4, island.size)) continue;
    playable = rest;
  }
  return playable;
}

// ─── Edge trim ────────────────────────────────────────────────────────────────
// Removes perimeter cells until `target` is reached, preserving connectivity.
function trimEdges(
  playable: Set<number>, target: number,
  cols: number, rows: number, rand: () => number,
): Set<number> {
  playable = new Set(playable);
  for (let attempt = 0; attempt < 10000 && playable.size > target; attempt++) {
    const arr   = [...playable];
    const cands = arr.filter(n => nbrs(n, cols, rows).filter(nb => playable.has(nb)).length <= 3);
    const pool  = cands.length > 0 ? cands : arr;
    const cell  = pool[Math.floor(rand() * pool.length)];
    const rest  = new Set(arr.filter(n => n !== cell));
    if (isConnected(rest, cols, rows)) playable = rest;
  }
  return playable;
}

// ─── Board generation ─────────────────────────────────────────────────────────
function generateBoard(
  cols: number, rows: number,
  playPct: number, jitter: number,
  minIsland: number, maxIsland: number,
  rand: () => number,
): Set<number> {
  const target = Math.max(4, Math.round(cols * rows * clamp(playPct, 5, 100) / 100));
  const full = (): Set<number> => {
    const s = new Set<number>();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) s.add(enc(c, r));
    return s;
  };
  let playable = outerShape(cols, rows, jitter, rand);
  if (playable.size === 0 || playable.size < target) playable = full();
  playable = carveIslands(playable, cols, rows, target, minIsland, maxIsland, rand);
  playable = trimEdges(playable, target, cols, rows, rand);
  return playable;
}

// ─── Dot collection ───────────────────────────────────────────────────────────
// Each playable cell contributes its four corner dots; duplicates are deduplicated.
function collectDots(cells: Set<number>): Array<[number, number]> {
  const set = new Set<number>();
  for (const n of cells) {
    const c = decC(n), r = decR(n);
    // Dot grid spans 0..cols and 0..rows; STRIDE=64 is safe since cols ≤ 28.
    set.add(enc(c,     r    ));
    set.add(enc(c + 1, r    ));
    set.add(enc(c,     r + 1));
    set.add(enc(c + 1, r + 1));
  }
  return [...set].map(d => [decC(d), decR(d)]);
}

// ─── Border walls ─────────────────────────────────────────────────────────────
// For each playable cell edge that borders a non-playable cell (or the grid
// boundary), emit a wall segment as [c1, r1, c2, r2] in dot-grid coordinates.
function collectBorderWalls(cells: Set<number>): Array<[number, number, number, number]> {
  const walls: Array<[number, number, number, number]> = [];
  for (const n of cells) {
    const c = decC(n), r = decR(n);
    if (!cells.has(enc(c,     r - 1))) walls.push([c,     r,     c + 1, r    ]); // top
    if (!cells.has(enc(c,     r + 1))) walls.push([c,     r + 1, c + 1, r + 1]); // bottom
    if (!cells.has(enc(c - 1, r    ))) walls.push([c,     r,     c,     r + 1]); // left
    if (!cells.has(enc(c + 1, r    ))) walls.push([c + 1, r,     c + 1, r + 1]); // right
  }
  return walls;
}

// ─── Template builder ─────────────────────────────────────────────────────────
export function buildDotsBoxesTemplate(
  cal: Calibration,
  t: Translator,
  settings: { density: DotsDensity; seed: number; jitter: DotsJitter; playable: DotsPlayable },
): TemplateSpec {
  const { width: usableW, height: usableH } = usableArea(cal);

  // Board is capped at 88 % of usable area so there is visible breathing room.
  const maxW = usableW * 0.88;
  const maxH = usableH * 0.88;

  const densityFactor =
    settings.density === "relaxed" ? 1.12 :
    settings.density === "dense"   ? 0.62 :
    settings.density === "extreme" ? 0.40 : 1;
  const targetCell = clamp((Math.min(maxW, maxH) / 6.2) * densityFactor, 5, 24);
  const cols = clamp(Math.floor(maxW / targetCell), 6, 28);
  const rows = clamp(Math.floor(maxH / targetCell), 5, 20);
  const cell = Math.min(maxW / cols, maxH / rows);
  const dot  = clamp(cell * 0.09, 0.7, 1.8);

  const jitterMap: Record<DotsJitter, number>   = { straight: 0, organic: 4, wild: 10 };
  const playPctMap: Record<DotsPlayable, number> = { sparse: 42, balanced: 68, full: 93 };
  const borderJitter = jitterMap[settings.jitter];
  const playPct      = playPctMap[settings.playable];
  const minIsland    = Math.max(2, Math.floor(cols * rows * 0.01));
  const maxIsland    = Math.max(4, Math.floor(cols * rows * 0.07));

  const rand  = mulberry32(settings.seed);
  const cells = generateBoard(cols, rows, playPct, borderJitter, minIsland, maxIsland, rand);
  const dots  = collectDots(cells);

  // Bounding box — organic shapes may not span the full cols × rows area.
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const [c, r] of dots) {
    if (c < minC) minC = c; if (c > maxC) maxC = c;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
  }

  const boardW = (maxC - minC) * cell;
  const boardH = (maxR - minR) * cell;
  const [x0, y0] = centeredOrigin(boardW, boardH, cal, t);

  const borderWalls = collectBorderWalls(cells);
  const wallLines: Pt[][] = borderWalls.map(([c1, r1, c2, r2]) => [
    [x0 + (c1 - minC) * cell, y0 + (r1 - minR) * cell],
    [x0 + (c2 - minC) * cell, y0 + (r2 - minR) * cell],
  ]);

  const lines: Pt[][] = [
    ...dots.map(([c, r]) => circle([x0 + (c - minC) * cell, y0 + (r - minR) * cell], dot)),
    ...wallLines,
  ];

  return {
    name: t("game.dotsBoxes.name"),
    lines,
    width: boardW,
    height: boardH,
    details: [
      { label: t("games.param.density"),     value: t(`games.option.density.${settings.density}`) },
      { label: t("games.param.borderShape"), value: t(`games.option.borderShape.${settings.jitter}`) },
      { label: t("games.param.playable"),    value: t(`games.option.playable.${settings.playable}`) },
      { label: t("games.param.cellSize"),    value: formatMm(cell) },
      { label: t("games.param.boxesWide"),   value: String(cols) },
      { label: t("games.param.boxesHigh"),   value: String(rows) },
    ],
  };
}
