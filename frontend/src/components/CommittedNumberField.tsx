import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { formatDecimalInput, parseDecimalInput } from "../lib/decimalInput";

/** Unfinished input stays local. Decimal mode also supports commas and unit suffixes. */
export default function CommittedNumberField({ label, unit = "mm", value, onChange, min, max, step = 0.1,
  disabled = false, decimalInput = false, rejectionMessage }: {
  label: string; unit?: string; value: number; onChange: (value: number) => unknown;
  min?: number; max?: number; step?: number; disabled?: boolean;
  decimalInput?: boolean; rejectionMessage?: string;
}) {
  const { t, lang } = useI18n();
  const id = useId();
  const editing = useRef(false), dirty = useRef(false), skipBlur = useRef(false);
  const originalValue = useRef(value);
  const format = (number: number) => decimalInput ? formatDecimalInput(number, lang) : String(number);
  const [draft, setDraft] = useState(() => format(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing.current) { setDraft(format(value)); setError(null); }
  }, [value, lang, decimalInput]);

  const commit = (input: HTMLInputElement) => {
    editing.current = false;
    if (skipBlur.current || disabled) { skipBlur.current = false; return; }
    if (decimalInput && dirty.current && originalValue.current !== value) {
      setDraft(format(value)); dirty.current = false;
      setError(t("number.valueChanged"));
      return;
    }
    const next = decimalInput ? parseDecimalInput(input.value, unit) : input.value === "" ? null : Number(input.value);
    if (next === null || !Number.isFinite(next) || (min !== undefined && next < min) || (max !== undefined && next > max)) {
      setError(t("calibrate.invalidNumber")); return;
    }
    if (next !== value && onChange(next) === false) {
      setError(rejectionMessage ?? t("calibrate.invalidNumber")); return;
    }
    dirty.current = false; originalValue.current = next;
    setError(null); setDraft(format(next));
  };

  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="input-unit">
      <input id={id} type={decimalInput ? "text" : "number"} inputMode={decimalInput ? "decimal" : undefined}
        role={decimalInput ? "spinbutton" : undefined} autoComplete="off"
        aria-valuemin={decimalInput ? min : undefined} aria-valuemax={decimalInput ? max : undefined}
        aria-valuenow={decimalInput ? parseDecimalInput(draft, unit) ?? undefined : undefined}
        value={draft} min={min} max={max} step={step} disabled={disabled}
        aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-error` : undefined}
        onFocus={() => { editing.current = true; originalValue.current = value; dirty.current = false; skipBlur.current = false; }}
        onChange={(event) => { dirty.current = true; setDraft(event.target.value); setError(null); }}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); skipBlur.current = true;
            editing.current = false; dirty.current = false;
            event.currentTarget.value = format(value); setDraft(format(value)); setError(null);
            event.currentTarget.blur();
          }
          if (decimalInput && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            const base = parseDecimalInput(draft, unit) ?? value;
            const delta = step * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1) * (event.key === "ArrowUp" ? 1 : -1);
            const next = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Number((base + delta).toPrecision(15))));
            dirty.current = true; setDraft(format(next)); setError(null);
          }
        }} />
      {unit && <em>{unit}</em>}
    </div>
    {error && <small id={`${id}-error`} className="field-error" role="alert">{error}</small>}
  </div>;
}
