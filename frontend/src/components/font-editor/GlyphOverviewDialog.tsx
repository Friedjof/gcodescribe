import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import Modal from "../Modal";
import Segmented from "../Segmented";
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
      bodyClassName="fe-overview-modal-body"
      headerActions={
        <span className="fe-overview-count">
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
          <Segmented<StatusFilter>
            className="fe-overview-seg"
            value={status}
            onChange={setStatus}
            options={STATUS.map((s) => ({ value: s, label: t(`fontEditor.filter_${s}`) }))}
          />
          <Segmented<KindFilter>
            className="fe-overview-seg"
            value={kind}
            onChange={setKind}
            options={KIND.map((k) => ({ value: k, label: t(`fontEditor.kind_${k}`) }))}
          />
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
