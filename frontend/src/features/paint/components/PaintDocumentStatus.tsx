import type { CalibrationProfile, Page } from "../../../api";
import EditorIcon from "../../../components/editor/EditorIcon";
import { useI18n } from "../../../i18n";
export default function PaintDocumentStatus({
  page,
  profile,
  pending,
  error,
  selection,
}: {
  page: Page;
  profile: CalibrationProfile | null;
  pending: boolean;
  error?: string;
  selection: number;
}) {
  const { t } = useI18n(),
    label = t(error ? "save.failed" : pending ? "save.saving" : "save.saved");
  return (
    <div className="paint-document-status">
      <span
        className={`document-save-indicator ${error ? "error" : pending ? "pending" : "saved"}`}
        title={label}
      >
        <EditorIcon
          name={error ? "help" : pending ? "more" : "check"}
          size={14}
        />
        <span className="sr-only" role="status">
          {label}
        </span>
      </span>
      <strong title={page.name}>{page.name}</strong>
      {profile && (
        <span
          className="document-profile-label"
          title={`${profile.name} · ${profile.calibration.plot_width.toFixed(1)} × ${profile.calibration.plot_height.toFixed(1)} mm`}
        >
          {profile.name}
        </span>
      )}
      {selection > 0 && (
        <span>{t("paint.selectionCount", { count: selection })}</span>
      )}
    </div>
  );
}
