import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import Modal from "../Modal";
import type { StrokeFontDocument } from "../../api";
import {
  filterEntries,
  overviewEntries,
  requiredCoverage,
  type KindFilter,
  type StatusFilter,
} from "../../fontEditor/coverage";

const STATUS: StatusFilter[] = ["all", "captured", "missing"];
const KIND: KindFilter[] = ["all", "single", "multi"];

export default function GlyphOverviewDialog({
  doc,
  onPick,
  onClose,
}: {
  doc: StrokeFontDocument;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");

  const cov = useMemo(() => requiredCoverage(doc), [doc]);
  const entries = useMemo(() => overviewEntries(doc), [doc]);
  const shown = useMemo(
    () => filterEntries(entries, { query, status, kind }),
    [entries, query, status, kind]
  );

  return (
    <Modal
      title={t("fontEditor.overviewTitle")}
      onClose={onClose}
      className="fe-overview-modal"
      headerActions={
        <span className="muted">
          {t("fontEditor.coverage", { present: cov.present, total: cov.total })}
        </span>
      }
    >
      <div className="fe-overview">
        <div className="fe-overview-filters">
          <input
            className="fe-search"
            value={query}
            placeholder={t("fontEditor.search")}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="fe-overview-seg">
            {STATUS.map((s) => (
              <button
                key={s}
                className={status === s ? "primary" : "ghost"}
                onClick={() => setStatus(s)}
              >
                {t(`fontEditor.filter_${s}`)}
              </button>
            ))}
          </div>
          <div className="fe-overview-seg">
            {KIND.map((k) => (
              <button key={k} className={kind === k ? "primary" : "ghost"} onClick={() => setKind(k)}>
                {t(`fontEditor.kind_${k}`)}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="muted">{t("fontEditor.noMatches")}</p>
        ) : (
          <div className="fe-overview-grid">
            {shown.map((e) => (
              <button
                key={e.key}
                className={`fe-overview-cell ${e.captured ? "is-captured" : "is-missing"}`}
                title={e.captured ? t("fontEditor.captured") : t("fontEditor.missing")}
                onClick={() => {
                  onPick(e.key);
                  onClose();
                }}
              >
                {e.key}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
