import { type ReactNode } from "react";

/** Labelled number input with a unit suffix (`mm`, `°`, …) — the shared
 * `.field` + `.input-unit` markup previously copy-pasted across panels.
 * Empty input fires no change, matching the previous inline handlers. */
export default function NumberField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  step,
  disabled = false,
  className = "field",
}: {
  label: ReactNode;
  unit?: string;
  /** Empty string renders an empty input (e.g. no selection). */
  value: number | "";
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={className}>
      {label}
      <div className="input-unit">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={value}
          onChange={(e) => {
            if (e.target.value !== "") onChange(Number(e.target.value));
          }}
        />
        {unit && <em>{unit}</em>}
      </div>
    </label>
  );
}
