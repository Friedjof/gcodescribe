import PagedGrid from "../../../components/paging/PagedGrid";
import { useMemo, useState } from "react";
import { useI18n } from "../../../i18n";
import Modal from "../../../components/Modal";
import Segmented from "../../../components/Segmented";
import type { StrokeFontDocument } from "../../../api";
import {
  filterEntries,
  overviewEntries,
  requiredCoverage,
  type KindFilter,
  type StatusFilter,
} from "../lib/coverage";

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
          <PagedGrid minWidth={48} footerHeight={10} label={t("fontEditor.overviewTitle")} resetKey={`${query}/${status}/${kind}`} items={shown} itemKey={(entry) => entry.key} renderItem={(entry) => <button className={`fe-overview-cell ${entry.captured ? "is-captured" : "is-missing"}`} title={t(entry.captured ? "fontEditor.captured" : "fontEditor.missing")} onClick={() => { onPick(entry.key); onClose(); }}>{entry.key}</button>}/>

        )}
      </div>
    </Modal>
  );
}
