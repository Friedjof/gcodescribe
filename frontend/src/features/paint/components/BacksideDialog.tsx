import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Calibration, Page, PageMeta } from "../../../api";
import Modal from "../../../components/Modal";
import PaginationBar from "../../../components/paging/PaginationBar";
import { useI18n } from "../../../i18n";
import PageThumbnail from "../PageThumbnail";
import { useReferencePage } from "../hooks/useBacksideReference";
import { backsideFlip, type BacksideSettings } from "../lib/backside";
import BacksideLayer from "./canvas/BacksideLayer";
import ObjectsLayer from "./canvas/ObjectsLayer";

export default function BacksideDialog({ page, pages, cal, settings, onApply, onClose }: {
  page: Page; pages: PageMeta[]; cal: Calibration; settings: BacksideSettings | null;
  onApply: (settings: BacksideSettings | null) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [sourceId, setSourceId] = useState(settings?.sourceId ?? "");
  const [edge, setEdge] = useState(settings?.edge ?? "long");
  const [opacity, setOpacity] = useState(settings?.opacity ?? .15);
  const [query, setQuery] = useState("");
  const [requestedPage, setPage] = useState(0);
  const candidates = pages.filter(item => item.id !== page.id);
  const filtered = candidates.filter(item => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const count = Math.max(1, Math.ceil(filtered.length / 6)), current = Math.min(requestedPage, count - 1);
  const source = candidates.find(item => item.id === sourceId);
  const reference = useReferencePage(source?.id, page.projectId, source?.modified, true);
  const { verticalHinge } = backsideFlip(cal, edge);
  const apply = () => {
    if (!reference.page || reference.loading || reference.error) return;
    onApply({ sourceId: reference.page.id, edge, opacity, enabled: true }); onClose();
  };
  return createPortal(<Modal title={t("backside.title")} onClose={onClose} className="backside-dialog"
    footer={<>
      {settings && <button type="button" onClick={() => { onApply(null); onClose(); }}>{t("backside.remove")}</button>}
      <button type="button" onClick={onClose}>{t("common.cancel")}</button>
      <button type="button" className="primary" disabled={!reference.page || reference.loading || !!reference.error}
        onClick={apply}>{t("backside.apply")}</button>
    </>}>
    <p className="backside-intro">{t("backside.intro")}</p>
    <div className="backside-dialog-layout">
      <section className="backside-slide-picker" aria-label={t("backside.chooseSlide")}>
        <h3>{t("backside.chooseSlide")}</h3>
        <input type="search" aria-label={t("backside.search")} placeholder={t("backside.search")}
          value={query} onChange={event => { setQuery(event.target.value); setPage(0); }}/>
        <div className="backside-slide-list">
          {filtered.slice(current * 6, current * 6 + 6).map(item => <button key={item.id} type="button"
            aria-pressed={item.id === sourceId} onClick={() => setSourceId(item.id)}>
            <PageThumbnail page={item}/><span>{item.name}</span>
          </button>)}
          {!filtered.length && <p className="muted">{t(candidates.length ? "backside.noMatches" : "backside.noSlides")}</p>}
        </div>
        {count > 1 && <PaginationBar page={current} pages={count} onChange={setPage} label={t("backside.chooseSlide")}/>}
      </section>
      <section className="backside-preview-panel">
        <label>{t("backside.turnEdge")}
          <select value={edge} onChange={event => setEdge(event.target.value as typeof edge)}>
            <option value="long">{t("backside.longEdge")}</option>
            <option value="short">{t("backside.shortEdge")}</option>
          </select>
        </label>
        <p className="backside-instruction">{t(verticalHinge ? "backside.turnSideways" : "backside.turnUpwards")}</p>
        <div className="backside-previews">
          <figure><figcaption>{t("backside.front")} {source?.name && `· ${source.name}`}</figcaption>
            <SheetPreview cal={cal} source={reference.page} current={page} edge={edge} opacity={opacity} backside={false}/>
          </figure>
          <span className="backside-turn-arrow" aria-hidden="true">{verticalHinge ? "↔" : "↕"}</span>
          <figure><figcaption>{t("backside.back")} · {page.name}</figcaption>
            <SheetPreview cal={cal} source={reference.page} current={page} edge={edge} opacity={opacity} backside/>
          </figure>
        </div>
        <p className="backside-orientation-note"><span aria-hidden="true">●</span> {t("backside.orientationCorner")}</p>
        <label className="backside-opacity">{t("backside.opacity")} <strong>{Math.round(opacity * 100)}%</strong>
          <input type="range" min={5} max={40} step={5} value={Math.round(opacity * 100)}
            aria-label={t("backside.opacity")} onChange={event => setOpacity(Number(event.target.value) / 100)}/>
        </label>
        {reference.loading && <p role="status">{t("common.loading")}</p>}
        {reference.error && <p role="alert" className="err">{t(reference.error)}</p>}
        {settings && !source && <p className="muted">{t("backside.missingSource")}</p>}
        <p className="backside-view-only">{t("backside.viewOnly")}</p>
      </section>
    </div>
  </Modal>, document.body);
}

function SheetPreview({ cal, source, current, edge, opacity, backside }: {
  cal: Calibration; source: Page | null; current: Page; edge: BacksideSettings["edge"];
  opacity: number; backside: boolean;
}) {
  const { frame, paper, transform } = backsideFlip(cal, edge);
  const pad = Math.max(frame.width, frame.height) * .04;
  const corner = [paper[0][0] + .05 * (paper[1][0] - paper[0][0]) + .05 * (paper[3][0] - paper[0][0]),
    paper[0][1] + .05 * (paper[1][1] - paper[0][1]) + .05 * (paper[3][1] - paper[0][1])];
  const objects = useMemo(() => (backside ? current : source)?.objects.map((object, index) => ({ object, index }))
    .sort((a, b) => (a.object.zOrder ?? a.index) - (b.object.zOrder ?? b.index))
    .map(({ object }) => ({ ...object, plotted: false })) ?? [], [backside, current.objects, source?.objects]);
  return <svg viewBox={`${frame.x - pad} ${frame.y - pad} ${frame.width + 2 * pad} ${frame.height + 2 * pad}`}
    className="backside-sheet-preview" aria-hidden="true">
    <polygon points={paper.map(point => point.join(",")).join(" ")} fill="var(--paper)"
      stroke="var(--paper-border)" strokeWidth={1} vectorEffect="non-scaling-stroke"/>
    {backside && source && <BacksideLayer page={source} cal={cal} edge={edge} opacity={opacity} stroke={.4}/>}
    <ObjectsLayer objects={objects} selectedIds={[]} stroke={.4}/>
    <g transform={backside ? transform : undefined}>
      <circle cx={corner[0]} cy={corner[1]} r={pad * .55} fill="var(--err)"/>
      <path d={`M ${corner[0]} ${corner[1]} l ${(paper[1][0] - paper[0][0]) * .18} ${(paper[1][1] - paper[0][1]) * .18}`} stroke="var(--err)" strokeWidth={2} vectorEffect="non-scaling-stroke"/>
    </g>
  </svg>;
}
