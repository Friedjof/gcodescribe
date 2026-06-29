import { useI18n } from "../../i18n";

export type ImageMode = "edges" | "hatch" | "lines" | "dots" | "handwriting";

export interface PaintImageModalProps {
  file: File;
  mode: ImageMode;
  detail: number;
  importing: boolean;
  continuous: boolean;
  onModeChange: (m: ImageMode) => void;
  onDetailChange: (d: number) => void;
  onContinuousChange: (v: boolean) => void;
  onCancel: () => void;
  onImport: () => void;
}

export function PaintImageModal({
  file,
  mode,
  detail,
  importing,
  continuous,
  onModeChange,
  onDetailChange,
  onContinuousChange,
  onCancel,
  onImport,
}: PaintImageModalProps) {
  const { t } = useI18n();

  const imageModes: { value: ImageMode; label: string; description: string }[] = [
    { value: "handwriting", label: t("paint.image.handwriting"), description: t("paint.image.handwritingDesc") },
    { value: "edges", label: t("paint.image.edges"), description: t("paint.image.edgesDesc") },
    { value: "hatch", label: t("paint.image.hatch"), description: t("paint.image.hatchDesc") },
    { value: "lines", label: t("paint.image.lines"), description: t("paint.image.linesDesc") },
    { value: "dots", label: t("paint.image.dots"), description: t("paint.image.dotsDesc") },
  ];

  return (
    <div className="paint-modal-backdrop" onMouseDown={() => !importing && onCancel()}>
      <div className="paint-import-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t("paint.image.title")}</h3>
        <p className="muted">{file.name}</p>
        <div className="paint-import-modes">
          {imageModes.map((m) => (
            <button
              key={m.value}
              className={mode === m.value ? "active" : ""}
              onClick={() => onModeChange(m.value)}
            >
              <strong>{m.label}</strong>
              <span>{m.description}</span>
            </button>
          ))}
        </div>
        <label className="field">
          {t("paint.image.detail")}
          <select value={detail} onChange={(e) => onDetailChange(Number(e.target.value))}>
            <option value={1}>{t("paint.image.low")}</option>
            <option value={2}>{t("paint.image.medium")}</option>
            <option value={3}>{t("paint.image.high")}</option>
          </select>
        </label>
        <label className="switch-label" title={t("paint.continuousHint")}>
          <input
            type="checkbox"
            checked={continuous}
            onChange={(e) => onContinuousChange(e.target.checked)}
          />
          {t("paint.continuous")}
        </label>
        <div className="job-actions">
          <button className="ghost" disabled={importing} onClick={onCancel}>
            {t("paint.cancel")}
          </button>
          <button className="primary" disabled={importing} onClick={onImport}>
            {importing ? t("paint.converting") : t("paint.insert")}
          </button>
        </div>
      </div>
    </div>
  );
}
