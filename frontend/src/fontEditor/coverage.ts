import type { StrokeFontDocument } from "../api";
import { REQUIRED_KEYS } from "./constants";

// Pure coverage + key helpers shared by the sidebar, symbol picker and overview.

// Mirrors the backend limit in plotter/stroke_fonts/model.py (MAX_KEY_LENGTH).
export const MAX_KEY_LENGTH = 64;

export function capturedKeys(doc: StrokeFontDocument | null): Set<string> {
  return new Set(doc?.glyphs.map((g) => g.key) ?? []);
}

export interface CoverageSummary {
  total: number;
  present: number;
  missing: string[];
}

/** Coverage against the Minimal-English required set. */
export function requiredCoverage(doc: StrokeFontDocument | null): CoverageSummary {
  const caps = capturedKeys(doc);
  const missing = REQUIRED_KEYS.filter((k) => !caps.has(k));
  return { total: REQUIRED_KEYS.length, present: REQUIRED_KEYS.length - missing.length, missing };
}

export type KeyValidation = { ok: true } | { ok: false; reason: "empty" | "tooLong" };

export function validateKey(key: string): KeyValidation {
  const trimmed = key.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if ([...trimmed].length > MAX_KEY_LENGTH) return { ok: false, reason: "tooLong" };
  return { ok: true };
}

export type StatusFilter = "all" | "captured" | "missing";
export type KindFilter = "all" | "single" | "multi";

export interface OverviewEntry {
  key: string;
  captured: boolean;
  type: string | null;
}

/** Captured glyphs unioned with the required set, sorted, for the overview. */
export function overviewEntries(doc: StrokeFontDocument | null): OverviewEntry[] {
  const captured = new Map((doc?.glyphs ?? []).map((g) => [g.key, g.type] as const));
  const keys = new Set<string>([...REQUIRED_KEYS, ...captured.keys()]);
  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ key, captured: captured.has(key), type: captured.get(key) ?? null }));
}

export function filterEntries(
  entries: OverviewEntry[],
  opts: { query: string; status: StatusFilter; kind: KindFilter }
): OverviewEntry[] {
  const q = opts.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (opts.status === "captured" && !e.captured) return false;
    if (opts.status === "missing" && e.captured) return false;
    const len = [...e.key].length;
    if (opts.kind === "single" && len !== 1) return false;
    if (opts.kind === "multi" && len === 1) return false;
    if (q && !e.key.toLowerCase().includes(q)) return false;
    return true;
  });
}
