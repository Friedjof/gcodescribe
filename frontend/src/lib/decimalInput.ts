/** Decimal notation only: never interpret grouping separators or expressions. */
export function parseDecimalInput(text: string, unit = ""): number | null {
  let input = text.trim();
  if (unit && input.toLowerCase().endsWith(unit.toLowerCase())) input = input.slice(0, -unit.length).trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(input)) return null;
  const number = Number(input.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export function formatDecimalInput(value: number, language?: string): string {
  const text = /e/i.test(String(value)) && Number.isFinite(value)
    ? value.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 }) : String(value);
  return ["de", "ba", "fr", "es"].includes(language ?? "") ? text.replace(".", ",") : text;
}
