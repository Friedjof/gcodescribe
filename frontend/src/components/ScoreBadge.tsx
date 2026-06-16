import type { GalleryScore } from "../api";

export function scoreClass(total: number): string {
  if (total >= 70) return "ok";
  if (total >= 40) return "warn";
  return "err";
}

/** Compact plottability score chip used on gallery cards and detail views.
 * Admin assets are unscored — nothing is rendered for them. */
export default function ScoreBadge({ score }: { score?: GalleryScore }) {
  if (!score) return null;
  return <span className={`score-badge ${scoreClass(score.total)}`}>{score.total}</span>;
}
