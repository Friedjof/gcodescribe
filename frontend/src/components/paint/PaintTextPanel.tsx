import type { SceneObject } from "../../api";
import { type TextFont } from "../../paint/text";
import { fontLabel, useTextFonts } from "../../paint/useTextFonts";
import { useI18n } from "../../i18n";

export interface PaintTextPanelProps {
  selectedText: SceneObject;
  draftText: string | null;
  defaultText: string;
  onTextInput: (id: string, text: string) => void;
  onFontOrSizeChange: (id: string, patch: Partial<{ text: string; size: number; font: TextFont }>) => void;
}

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
    <div className="paint-object-panel">
      <div className="field">
        <label>{t("paint.text")}</label>
        <textarea
          value={draftText ?? String(selectedText.data?.text ?? defaultText)}
          onChange={(e) => onTextInput(selectedText.id, e.target.value)}
          rows={3}
        />
      </div>
      <div className="fields">
        <div className="field">
          <label>{t("paint.font")}</label>
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
        </div>
        <div className="field">
          <label>{t("paint.size")}</label>
          <div className="input-unit">
            <input
              type="number"
              min={3}
              max={80}
              step={1}
              value={Number(selectedText.data?.size ?? 12)}
              onChange={(e) =>
                onFontOrSizeChange(selectedText.id, {
                  size: Math.max(3, Number(e.target.value) || 12),
                })
              }
            />
            <em>mm</em>
          </div>
        </div>
      </div>
    </div>
  );
}
