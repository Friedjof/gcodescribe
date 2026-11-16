// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTemplateSeeds } from "./useTemplateSeeds";
import { SEEDED_GAMES } from "../lib/constants";
describe("template random codes", () => {
  it("gives every random template a visible stable code including bingo", () => {
    const { result, rerender } = renderHook(useTemplateSeeds);
    const before = [...SEEDED_GAMES].map((id) => result.current.input(id)); rerender();
    expect([...SEEDED_GAMES].map((id) => result.current.input(id))).toEqual(before);
    expect(before.every((code) => /^\d{5}$/.test(code))).toBe(true);
  });
  it("keeps individual codes and rejects incomplete input without silently rerolling", () => {
    const { result } = renderHook(useTemplateSeeds);
    act(() => result.current.set("maze", "01234"));
    expect(result.current.resolve("maze")).toBe(1234);
    act(() => result.current.set("sudoku", "42"));
    expect(result.current.resolve("sudoku")).toBeNull();
    expect(result.current.input("maze")).toBe("01234");
    act(() => result.current.randomize("sudoku"));
    expect(result.current.resolve("sudoku")).not.toBeNull();
    expect(result.current.input("maze")).toBe("01234");
  });
});
