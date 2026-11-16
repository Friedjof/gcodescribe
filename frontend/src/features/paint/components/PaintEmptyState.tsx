import { useRef } from "react";
import EditorIcon from "../../../components/editor/EditorIcon";
import { useI18n } from "../../../i18n";
export default function PaintEmptyState({
  onText,
  onDraw,
  onImage,
}: {
  onText: () => void;
  onDraw: () => void;
  onImage: (file: File | undefined) => void;
}) {
  const { t } = useI18n(),
    input = useRef<HTMLInputElement>(null);
  return (
    <div className="paint-empty-hint">
      <EditorIcon name="pages" size={30} />
      <strong>{t("paint.emptyPageTitle")}</strong>
      <div className="paint-empty-actions">
        <button type="button" onClick={onText}>
          <EditorIcon name="text" size={19} />
          {t("paint.addText")}
        </button>
        <button type="button" onClick={() => input.current?.click()}>
          <EditorIcon name="image" size={19} />
          {t("paint.imageImport")}
        </button>
        <button type="button" onClick={onDraw}>
          <EditorIcon name="draw" size={19} />
          {t("paint.drawFree")}
        </button>
      </div>
      <span>{t("paint.dropHint")}</span>
      <input
        type="file"
        accept="image/*"
        hidden
        ref={input}
        onChange={(event) => {
          onImage(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
