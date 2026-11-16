import type { CalibrationProfileSummary } from "../../api";
import PaginationBar from "../../components/paging/PaginationBar";
import { useFitListPage } from "../../components/paging/useFitListPage";
import { useI18n } from "../../i18n";

export default function ProfileLibrary({ profiles, selectedId, onSelect, onActivate }: {
  profiles: CalibrationProfileSummary[]; selectedId: string | null;
  onSelect: (id: string) => void; onActivate: (id: string) => void;
}) {
  const { t } = useI18n();
  const paging = useFitListPage(profiles, 115, 3);
  return <>
    <div ref={paging.viewport} className="profile-list-scroll" role="region" aria-label={t("profiles.title")}>
      {paging.items.map((p) => <div key={p.id} className={`profile-item${p.id === selectedId ? " selected" : ""}${p.active ? " active" : ""}${p.archived ? " archived" : ""}`}>
        <button type="button" className="profile-select" aria-pressed={p.id === selectedId} onClick={() => onSelect(p.id)}>
          <div className="profile-item-head"><strong title={p.name}>{p.name}</strong>{p.active && <span className="pbadge pbadge-active">{t("profiles.activeBadge")}</span>}{p.archived && <span className="pbadge pbadge-muted">{t("profiles.archivedBadge")}</span>}</div>
          <div className="profile-item-info">{p.plot_width.toFixed(0)} × {p.plot_height.toFixed(0)} mm · @{p.origin_x.toFixed(0)}/{p.origin_y.toFixed(0)}</div>
          <span className={p.pen_calibrated ? "pen-ok" : "pen-missing"}>{t(p.pen_calibrated ? "profiles.penOk" : "profiles.penMissing")}</span>
        </button>
        {!p.active && !p.archived && <button type="button" className="profile-activate" onClick={() => onActivate(p.id)}>{t("profiles.activate")}</button>}
      </div>)}
    </div>
    <PaginationBar page={paging.page} pages={paging.pages} onChange={paging.setPage} label={t("profiles.title")}/>
  </>;
}
