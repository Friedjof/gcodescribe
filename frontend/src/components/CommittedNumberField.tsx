import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";

/** Keep unfinished numeric input local; apply only a valid completed value. */
export default function CommittedNumberField({ label, unit = "mm", value, onChange, min, max, step = 0.1 }: {
  label: string;
  unit?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const { t } = useI18n();
  const id = useId();
  const editing = useRef(false);
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!editing.current) { setDraft(String(value)); setInvalid(false); }
  }, [value]);

  const commit = (input: HTMLInputElement) => {
    editing.current = false;
    const next = Number(input.value);
    if (input.value === "" || !Number.isFinite(next)
        || (min !== undefined && next < min) || (max !== undefined && next > max)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="input-unit">
      <input id={id} type="number" value={draft} min={min} max={max} step={step}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
        onFocus={() => { editing.current = true; }}
        onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") {
            event.stopPropagation();
            event.currentTarget.value = String(value);
            setDraft(String(value));
            setInvalid(false);
            event.currentTarget.blur();
          }
        }} />
      <em>{unit}</em>
    </div>
    {invalid && <small id={`${id}-error`} className="field-error" role="alert">{t("calibrate.invalidNumber")}</small>}
  </div>;
}
