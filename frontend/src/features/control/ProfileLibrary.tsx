import type { CalibrationProfileSummary } from "../../api";
import PaginationBar from "../../components/paging/PaginationBar";
import { useFitListPage } from "../../components/paging/useFitListPage";
import { useI18n } from "../../i18n";

export default function ProfileLibrary({ profiles, selectedId, onSelect, projectProfileId, disabled = false }: {
  disabled?: boolean; profiles: CalibrationProfileSummary[]; selectedId: string | null;
  onSelect: (id: string) => void; projectProfileId?: string;
}) {
  const { t } = useI18n();
  const paging = useFitListPage(profiles, 69, 6);
  return <>
    <div ref={paging.viewport} className="profile-list-scroll" role="region" aria-label={t("profiles.title")}>
      {paging.items.map((p) => <div key={p.id} className={`profile-item${p.id === selectedId ? " selected" : ""}${p.id === projectProfileId ? " active" : ""}${p.archived ? " archived" : ""}`}>
        <button type="button" className="profile-select" disabled={disabled} aria-pressed={p.id === selectedId} onClick={() => onSelect(p.id)}>
          <div className="profile-item-head"><strong title={p.name}>{p.name}</strong>{p.id === projectProfileId && <span className="pbadge pbadge-active">{t("profiles.projectBadge")}</span>}{p.archived && <span className="pbadge pbadge-muted">{t("profiles.archivedBadge")}</span>}</div>
          <div className="profile-item-info">{p.plot_width.toFixed(0)} × {p.plot_height.toFixed(0)}  mm · @{p.origin_x.toFixed(0)}/{p.origin_y.toFixed(0)}</div>
          <span title={t(p.pen_calibrated ? "profiles.penOk" : "profiles.penMissing")} className={`profile-pen-status ${p.pen_calibrated ? "pen-ok" : "pen-missing"}`}>{t(p.pen_calibrated ? "profiles.penOk" : "profiles.penMissing")}</span>
        </button>
      </div>)}
    </div>
    <PaginationBar page={paging.page} pages={paging.pages} onChange={paging.setPage} label={t("profiles.title")}/>
  </>;
}
