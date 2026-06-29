import { describe, expect, it } from "vitest";
import {
  filterEntries,
  overviewEntries,
  requiredCoverage,
  validateKey,
} from "./coverage";
import { REQUIRED_KEYS } from "./constants";
import { upsertGlyph } from "./glyphModel";
import type { StrokeFontDocument } from "../api";

function doc(): StrokeFontDocument {
  return {
    schemaVersion: 1,
    id: "stroke-test",
    label: "Test",
    kind: "stroke",
    units: "em",
    metrics: {
      em: 1000,
      baseline: 0,
      xHeight: 460,
      capHeight: 700,
      ascender: 780,
      descender: -230,
      defaultAdvance: 560,
      wordSpacing: 280,
    },
    glyphs: [],
    coverage: { targetSet: "latin-basic-en-v1" },
    createdAt: "2026-06-29T00:00:00Z",
    updatedAt: "2026-06-29T00:00:00Z",
  };
}

describe("coverage", () => {
  it("reports the full required set as missing for an empty font", () => {
    const cov = requiredCoverage(doc());
    expect(cov.total).toBe(REQUIRED_KEYS.length);
    expect(cov.present).toBe(0);
    expect(cov.missing).toContain("a");
    expect(cov.missing).toContain("?");
  });

  it("marks captured keys as present", () => {
    const d = upsertGlyph(doc(), "a", []);
    const cov = requiredCoverage(d);
    expect(cov.present).toBe(1);
    expect(cov.missing).not.toContain("a");
  });

  it("ignores word keys that are not part of the required set", () => {
    const d = upsertGlyph(doc(), "the", []);
    const cov = requiredCoverage(d);
    expect(cov.present).toBe(0);
  });

  it("validates keys", () => {
    expect(validateKey("a")).toEqual({ ok: true });
    expect(validateKey("the")).toEqual({ ok: true });
    expect(validateKey("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validateKey("x".repeat(65))).toEqual({ ok: false, reason: "tooLong" });
  });

  it("builds overview entries unioning required + captured", () => {
    const d = upsertGlyph(doc(), "the", []);
    const entries = overviewEntries(d);
    const word = entries.find((e) => e.key === "the");
    expect(word?.captured).toBe(true);
    const letter = entries.find((e) => e.key === "a");
    expect(letter?.captured).toBe(false);
  });

  it("filters by status, kind and query", () => {
    const d = upsertGlyph(upsertGlyph(doc(), "a", []), "the", []);
    const entries = overviewEntries(d);

    const captured = filterEntries(entries, { query: "", status: "captured", kind: "all" });
    expect(captured.map((e) => e.key).sort()).toEqual(["a", "the"]);

    const missing = filterEntries(entries, { query: "", status: "missing", kind: "all" });
    expect(missing.every((e) => !e.captured)).toBe(true);

    const multi = filterEntries(entries, { query: "", status: "all", kind: "multi" });
    expect(multi.map((e) => e.key)).toEqual(["the"]);

    const single = filterEntries(entries, { query: "", status: "all", kind: "single" });
    expect(single.every((e) => [...e.key].length === 1)).toBe(true);

    const queried = filterEntries(entries, { query: "th", status: "all", kind: "all" });
    expect(queried.map((e) => e.key)).toEqual(["the"]);
  });
});
