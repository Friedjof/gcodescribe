import { useI18n } from "../../i18n";
import { validateKey } from "../../fontEditor/coverage";

export default function GlyphKeyInput({
  value,
  onChange,
  onSaveGlyph,
  onOpenSymbols,
  onNewGlyph,
  canSave,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSaveGlyph: () => void;
  onOpenSymbols: () => void;
  onNewGlyph: () => void;
  canSave: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const validation = validateKey(value);
  // Only flag a non-empty key that is otherwise invalid (e.g. too long).
  const invalid = value.trim().length > 0 && !validation.ok;

  return (
    <footer className="fe-keybar">
      <label className="fe-key-label" htmlFor="fe-key-input">
        {t("fontEditor.keyLabel")}
      </label>
      <input
        id="fe-key-input"
        className={`fe-key-input ${invalid ? "is-invalid" : ""}`}
        value={value}
        placeholder={t("fontEditor.keyPlaceholder")}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && canSave && onSaveGlyph()}
        disabled={disabled}
        aria-invalid={invalid}
      />
      {invalid && <span className="fe-key-error">{t("fontEditor.keyTooLong")}</span>}
      <button className="ghost" onClick={onNewGlyph} disabled={disabled}>
        {t("fontEditor.newGlyph")}
      </button>
      <button className="ghost" onClick={onOpenSymbols} disabled={disabled}>
        {t("fontEditor.specialChars")}
      </button>
      <button className="primary" onClick={onSaveGlyph} disabled={!canSave}>
        {t("fontEditor.saveGlyph")}
      </button>
    </footer>
  );
}
