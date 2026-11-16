import { useId } from "react";
import { useI18n } from "../i18n";
import EditorIcon from "./editor/EditorIcon";

export default function SeedControl({
  value,
  onChange,
  onRandomize,
  disabled = false,
  font = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onRandomize: () => void;
  disabled?: boolean;
  font?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const valid = font
    ? /^\d{1,10}$/.test(value) && Number(value) <= 0x7fffffff
    : /^\d{5}$/.test(value);
  return (
    <div className="seed-control">
      <label htmlFor={id}>{t("seed.label")}</label>
      <div className="seed-control-row">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={value}
          maxLength={font ? 10 : 5}
          disabled={disabled}
          aria-invalid={!valid}
          aria-describedby={`${id}-help${valid ? "" : ` ${id}-error`}`}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onRandomize}
          title={t("seed.new")}
          aria-label={t("seed.new")}
        >
          <EditorIcon name="dice" size={19} />
        </button>
      </div>
      <p id={`${id}-help`}>{t(font ? "seed.fontHint" : "seed.hint")}</p>
      {!valid && (
        <p id={`${id}-error`} role="alert">
          {t(font ? "seed.fontInvalid" : "games.errorSeedLength")}
        </p>
      )}
    </div>
  );
}
