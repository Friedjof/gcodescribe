import type { SceneObject } from "../../../api";
import NumberField from "../../../components/NumberField";
import { type TextFont } from "../lib/text";
import { fontLabel, useTextFonts } from "../hooks/useTextFonts";
import { useI18n } from "../../../i18n";

export interface PaintTextPanelProps {
  selectedText: SceneObject;
  draftText: string | null;
  defaultText: string;
  onTextInput: (id: string, text: string) => void;
  onFontOrSizeChange: (id: string, patch: Partial<{ text: string; size: number; font: TextFont }>) => void;
}

/** Content/font/size editor for the selected text object; rendered as a
 * section inside the context panel. */
export function PaintTextPanel({
  selectedText,
  draftText,
  defaultText,
  onTextInput,
  onFontOrSizeChange,
}: PaintTextPanelProps) {
  const { t } = useI18n();
  const { fonts } = useTextFonts();

  return (
    <div className="paint-text-section">
      <label className="field">
        {t("paint.text")}
        <textarea
          value={draftText ?? String(selectedText.data?.text ?? defaultText)}
          onChange={(e) => onTextInput(selectedText.id, e.target.value)}
          rows={3}
        />
      </label>
      <label className="field">
        {t("paint.font")}
        <select
          value={(selectedText.data?.font ?? "sans") as TextFont}
          onChange={(e) =>
            onFontOrSizeChange(selectedText.id, { font: e.target.value as TextFont })
          }
        >
          {fonts.map((font) => (
            <option key={font.id} value={font.id}>
              {fontLabel(font, t)}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        label={t("paint.size")}
        unit="mm"
        min={3}
        max={80}
        step={1}
        value={Number(selectedText.data?.size ?? 12)}
        onChange={(v) =>
          onFontOrSizeChange(selectedText.id, { size: Math.max(3, v || 12) })
        }
      />
    </div>
  );
}
