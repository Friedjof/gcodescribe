import PaginationBar from "../../../components/paging/PaginationBar";
import { useFitListPage } from "../../../components/paging/useFitListPage";
import { useMemo, useState } from "react";
import { useI18n } from "../../../i18n";
import type { StrokeGlyph } from "../../../api";

export default function GlyphSidebar({
  glyphs,
  activeKey,
  coverage,
  onSelect,
  onOpenOverview,
}: {
  glyphs: StrokeGlyph[];
  activeKey: string;
  coverage: { present: number; total: number };
  onSelect: (key: string) => void;
  onOpenOverview: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return glyphs;
    return glyphs.filter(
      (g) => g.key.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)
    );
  }, [glyphs, query]);

  const paging = useFitListPage(filtered, 43, 8);
  return (
    <aside className="fe-sidebar">
      <h3 className="fe-sidebar-title">{t("fontEditor.glyphs")}</h3>
      <div className="fe-coverage">
        <span className="muted">
          {t("fontEditor.coverage", { present: coverage.present, total: coverage.total })}
        </span>
        <button className="ghost" onClick={onOpenOverview}>
          {t("fontEditor.overview")}
        </button>
      </div>
      <input
        className="fe-search"
        value={query}
        placeholder={t("fontEditor.search")}
        onChange={(e) => { setQuery(e.target.value); paging.setPage(0); }}
      />
      <div className="fe-glyph-viewport" ref={paging.viewport}>
      {filtered.length === 0 ? (
        <p className="muted fe-sidebar-empty">{t("fontEditor.noGlyphs")}</p>
      ) : (
        <ul className="fe-glyph-list">
          {paging.items.map((glyph) => (
            <li key={glyph.key}>
              <button
                className={`fe-glyph-item ${glyph.key === activeKey ? "is-active" : ""}`}
                onClick={() => onSelect(glyph.key)}
              >
                <span className="fe-glyph-key">{glyph.label || glyph.key}</span>
                <span className="muted fe-glyph-type">{glyph.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
      <PaginationBar page={paging.page} pages={paging.pages} onChange={paging.setPage} label={t("fontEditor.glyphs")}/>
    </aside>
  );
}
