import { useMemo, useState } from "react";
import EditorIcon, {
  type EditorIconName,
} from "../../../components/editor/EditorIcon";
import PaginationBar from "../../../components/paging/PaginationBar";
import { useFitListPage } from "../../../components/paging/useFitListPage";
import { useI18n } from "../../../i18n";
import { ALL_GAMES, GAME_GROUPS, SUPPORTED_GAMES } from "../lib/constants";
import type { GameId } from "../lib/types";
const ICONS: Record<string, EditorIconName> = {
  grid: "grid",
  puzzle: "shape",
  coloring: "draw",
  maps: "map",
  party: "text",
};
export default function TemplateLibrary({
  selected,
  onSelect,
  onStl,
  ready,
}: {
  selected: GameId;
  onSelect: (id: GameId) => void;
  onStl: () => void;
  ready: boolean;
}) {
  const { t } = useI18n(),
    [category, setCategory] = useState("all");
  const items = useMemo(
    () =>
      category === "all"
        ? ALL_GAMES
        : (GAME_GROUPS.find((group) => group.key === category)?.games ?? []),
    [category],
  );
  const paging = useFitListPage(items, 48);
  return (
    <aside data-tour="template-library" className="template-library">
      <div className="template-library-head">
        <strong>{t("games.title")}</strong>
        <select
          aria-label={t("games.catalog")}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            paging.setPage(0);
          }}
        >
          <option value="all">{t("games.allCategories")}</option>
          {GAME_GROUPS.map((group) => (
            <option key={group.key} value={group.key}>
              {t(group.key)}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={paging.viewport}
        className="template-library-items"
        role="listbox"
        aria-label={t("games.catalog")}
      >
        {paging.items.map((game) => (
          <button
            type="button"
            key={game.id}
            role="option"
            aria-selected={selected === game.id}
            title={t(`game.${game.id}.desc`)}
            disabled={!SUPPORTED_GAMES.has(game.id)}
            onClick={() => onSelect(game.id)}
          >
            <EditorIcon name={ICONS[game.group] ?? "shape"} size={19} />
            <span>{t(`game.${game.id}.name`)}</span>
          </button>
        ))}
      </div>
      <PaginationBar
        label={t("games.catalog")}
        page={paging.page}
        pages={paging.pages}
        onChange={paging.setPage}
      />
      <button
        type="button"
        className="template-import"
        onClick={onStl}
        disabled={!ready}
      >
        <EditorIcon name="shape" size={16} />
        {t("stl.open")}
      </button>
    </aside>
  );
}
