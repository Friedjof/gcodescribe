import { useEffect, useRef, useState } from "react";
import { api, type GalleryMetrics, type GalleryScore, type PageScore, type SceneObject } from "../api";
import { fmtBytes, fmtDuration } from "../format";
import { useI18n } from "../i18n";
import { scoreClass } from "./ScoreBadge";

const DEBOUNCE_MS = 600;
const SUB_SCORES = ["time", "lifts", "size", "detail"] as const;

/** Debounced live rating of the canvas — every change is rated by the same
 * central backend evaluation the gallery uses, without writing a job file. */
function usePageScore(pageId: string, objects: SceneObject[]): PageScore | null {
  const [result, setResult] = useState<PageScore | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      api
        .pageScore(pageId, objects)
        .then((res) => seq.current === mine && setResult(res))
        .catch(() => seq.current === mine && setResult(null));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [pageId, objects]);

  return result;
}

function insights(
  t: (key: string, vars?: Record<string, string | number>) => string,
  score: GalleryScore,
  metrics: GalleryMetrics
): string[] {
  const hints: string[] = [];
  if (score.time < 50) hints.push(t("paint.score.insightTime", { min: Math.max(1, Math.round(metrics.duration_s / 60)) }));
  if (score.lifts < 50) hints.push(t("paint.score.insightLifts"));
  if (score.size < 50) hints.push(t("paint.score.insightSize"));
  if (score.detail < 50)
    hints.push(metrics.draw_mm < 1500 ? t("paint.score.insightDetailLow") : t("paint.score.insightDetailHigh"));
  if (hints.length === 0) hints.push(t("paint.score.insightGood"));
  return hints;
}

/** Floating plottability score over the paint canvas: colored chip top-left,
 * with a hover panel breaking down sub-scores, key facts and tuning hints. */
export default function PlotScore({ pageId, objects }: { pageId: string; objects: SceneObject[] }) {
  const result = usePageScore(pageId, objects);
  return <ScoreOverlay result={result} />;
}

/** Presentational score overlay — same chip + hover breakdown, driven by a
 * precomputed rating so any view (paint canvas, placement bed, …) can reuse it. */
export function ScoreOverlay({ result }: { result: PageScore | null }) {
  const { t } = useI18n();
  if (!result) return null;

  const { score, metrics, reason } = result;
  return (
    <div className="plot-score">
      <div className={`plot-score-chip ${score ? scoreClass(score.total) : "off"}`}>
        <span className="plot-score-label">{t("paint.score.title")}</span>
        <strong>{score ? score.total : "–"}</strong>
      </div>
      <div className="plot-score-panel">
        {score && metrics ? (
          <>
            <div className="plot-score-rows">
              {SUB_SCORES.map((key) => (
                <div key={key} className="plot-score-row">
                  <span>{t(`score.${key}`)}</span>
                  <div className="plot-score-bar">
                    <i className={scoreClass(score[key])} style={{ width: `${score[key]}%` }} />
                  </div>
                  <em>{score[key]}</em>
                </div>
              ))}
            </div>
            <dl className="plot-score-facts">
              <dt>{t("gallery.m.duration")}</dt>
              <dd>{fmtDuration(metrics.duration_s)}</dd>
              <dt>{t("gallery.m.penLifts")}</dt>
              <dd>{metrics.pen_lifts}</dd>
              <dt>{t("gallery.m.drawLen")}</dt>
              <dd>{(metrics.draw_mm / 1000).toFixed(2)} m</dd>
              <dt>{t("gallery.m.size")}</dt>
              <dd>{fmtBytes(metrics.size_bytes)}</dd>
            </dl>
            <ul className="plot-score-insights">
              {insights(t, score, metrics).map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">{reason ?? t("paint.score.empty")}</p>
        )}
      </div>
    </div>
  );
}
