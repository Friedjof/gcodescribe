import { expect, it } from "vitest";
import { formatDecimalInput, parseDecimalInput } from "./decimalInput";
it.each([["12,345 mm", "mm", 12.345], [".25", "mm", .25], ["-12,5°", "°", -12.5], ["+12.5", "", 12.5]])("parses %s", (text, unit, result) => {
  expect(parseDecimalInput(text as string, unit as string)).toBe(result);
});
it.each(["", " ", "1.000,5", "1,000.5", "0x10", "Infinity", "1/2", "12 cm", "NaN"])("rejects ambiguous or invalid input %s", text => {
  expect(parseDecimalInput(text, "mm")).toBeNull();
});
it("formats decimals without rounding away precision", () => {
  expect(formatDecimalInput(12.3456789, "de")).toBe("12,3456789");
  expect(formatDecimalInput(12.3456789, "en")).toBe("12.3456789");
});
it("round-trips small applied values without scientific notation", () => {
  const text = formatDecimalInput(1e-9, "de");
  expect(text).toBe("0,000000001");
  expect(parseDecimalInput(text)).toBe(1e-9);
});
