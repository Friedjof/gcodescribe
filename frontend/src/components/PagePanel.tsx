import { useEffect, useMemo, useRef, useState } from "react";
import type { PageIndex, PageMeta } from "../api";
import { useI18n } from "../i18n";

type SortKey = "manual" | "modified" | "name" | "created";

interface Group {
  key: string;
  label: string;
  active: boolean;
  items: PageMeta[];
}

export default function PagePanel({
  index,
  activePageId,
  activeProfileId,
  activeProfileName,
  onOpen,
  onNew,
  onRename,
  onDuplicate,
  onRemove,
  onReorder,
  sidebarCollapsed = false,
  onToggleSidebar,
}: {
  index: PageIndex;
  activePageId: string;
  activeProfileId?: string | null;
  activeProfileName?: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, current: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("manual");
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  // Drag & drop only makes sense against the persisted order; the other sort
  // modes are read-only views.
  const canDrag = sort === "manual" && !query.trim();

  // Move dragId so it lands before targetId in the persisted order, then push
  // the new full ordering up. Cross-group drops are harmless: the page keeps
  // its profile and simply regroups.
  const reorder = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = index.order.map((m) => m.id).filter((id) => id !== dragId);
    const at = ids.indexOf(targetId);
    if (at < 0) return;
    ids.splice(at, 0, dragId);
    onReorder(ids);
  };

  // Keep the active page on screen when it changes (e.g. created/opened
  // elsewhere or it scrolled out of a long list).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activePageId]);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? index.order.filter((m) => m.name.toLowerCase().includes(q))
      : index.order;
    const sorted =
      sort === "manual"
        ? filtered // keep the persisted order
        : [...filtered].sort((a, b) => {
            if (sort === "name") return a.name.localeCompare(b.name);
            if (sort === "created") return b.created - a.created;
            return b.modified - a.modified;
          });

    const map = new Map<string, Group>();
    const noProfile = t("paint.badgeNoProfile");
    for (const m of sorted) {
      const key = m.profileId ?? "__none__";
      const isActive = !!m.profileId && m.profileId === activeProfileId;
      let g = map.get(key);
      if (!g) {
        g = { key, label: m.profileName ?? noProfile, active: isActive, items: [] };
        map.set(key, g);
      }
      g.items.push(m);
    }
    // Active profile first, the rest alphabetically by label.
    return [...map.values()].sort((a, b) =>
      a.active === b.active ? a.label.localeCompare(b.label) : a.active ? -1 : 1
    );
  }, [index.order, query, sort, activeProfileId, t]);

  const multiGroup = groups.length > 1;
  const isGroupCollapsed = (g: Group) =>
    groupCollapsed[g.key] ?? (!g.active && !g.items.some((m) => m.id === activePageId));

  const renderItem = (m: PageMeta) => (
    <li
      key={m.id}
      ref={m.id === activePageId ? activeRef : undefined}
      className={
        (m.id === activePageId ? "active" : "") +
        (m.profileStatus && m.profileStatus !== "active" ? " foreign-profile" : "") +
        (dragId === m.id ? " dragging" : "") +
        (dropId === m.id ? " drop-target" : "")
      }
      title={sidebarCollapsed ? m.name : undefined}
      onClick={() => onOpen(m.id)}
      draggable={canDrag && !sidebarCollapsed}
      onDragStart={canDrag && !sidebarCollapsed ? () => setDragId(m.id) : undefined}
      onDragOver={
        canDrag && !sidebarCollapsed && dragId && dragId !== m.id
          ? (e) => { e.preventDefault(); setDropId(m.id); }
          : undefined
      }
      onDrop={canDrag && !sidebarCollapsed ? (e) => { e.preventDefault(); reorder(m.id); setDragId(null); setDropId(null); } : undefined}
      onDragEnd={() => { setDragId(null); setDropId(null); }}
    >
      <span className="page-thumb" aria-hidden="true">
        {m.thumb ? (
          <svg viewBox={`-1 -1 ${m.thumb.w + 2} ${m.thumb.h + 2}`} preserveAspectRatio="xMidYMid meet">
            <path d={m.thumb.d} fill="none" stroke="currentColor" strokeWidth={Math.max(m.thumb.w, m.thumb.h) / 60 || 1} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="page-thumb-empty">▦</span>
        )}
      </span>
      {!sidebarCollapsed && (
        <>
          <div className="page-info">
            <span className="page-name">
              {m.name}
              {m.profileStatus === "other" && (
                <span className="pbadge pbadge-other" title={t("paint.pageOtherProfile", { name: m.profileName ?? "?" })}>{m.profileName}</span>
              )}
              {m.profileStatus === "stale" && (
                <span className="pbadge pbadge-warn" title={t("paint.pageStale")}>{t("paint.badgeStale")}</span>
              )}
              {m.profileStatus === "archived" && (
                <span className="pbadge pbadge-muted" title={t("paint.pageArchivedProfile", { name: m.profileName ?? "?" })}>{t("paint.badgeArchived")}</span>
              )}
              {m.profileStatus === "missing" && (
                <span className="pbadge pbadge-muted">
                  {m.profileId ? t("paint.badgeMissingProfile") : t("paint.badgeNoProfile")}
                </span>
              )}
            </span>
            <span className="muted">
              {m.objectCount} {t("paint.objects")}{m.plottedCount > 0 && ` · ${m.plottedCount} ${t("paint.plotted")}`}
            </span>
          </div>
          <div className="page-acts" onClick={(e) => e.stopPropagation()}>
            <button className="ghost tiny" title={t("paint.rename")} onClick={() => onRename(m.id, m.name)}>✎</button>
            <button className="ghost tiny" title={t("paint.duplicate")} onClick={() => onDuplicate(m.id)}>⧉</button>
            <button className="ghost tiny" title={t("paint.delete")} onClick={() => onRemove(m.id)}>✕</button>
          </div>
        </>
      )}
    </li>
  );

  return (
    <aside className={`paint-pages${sidebarCollapsed ? " collapsed" : ""}`}>
      <div className="paint-pages-head">
        {!sidebarCollapsed && <h3>{t("paint.pages")}</h3>}
        {!sidebarCollapsed && <button className="ghost tiny" title={t("paint.newPage")} onClick={onNew}>＋</button>}
        <button
          className="ghost tiny pages-collapse-btn"
          title={sidebarCollapsed ? t("paint.expandSidebar") : t("paint.collapseSidebar")}
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? t("paint.expandSidebar") : t("paint.collapseSidebar")}
        >
          {sidebarCollapsed ? "▶" : "◀"}
        </button>
      </div>

      {!sidebarCollapsed && activeProfileName && (
        <p className="muted paint-profile">{t("paint.activeProfile", { name: activeProfileName })}</p>
      )}

      {!sidebarCollapsed && (
        <div className="paint-pages-controls">
          <input
            className="paint-pages-search"
            type="search"
            placeholder={t("paint.searchPages")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="paint-pages-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label={t("paint.sortManual")}
          >
            <option value="manual">{t("paint.sortManual")}</option>
            <option value="modified">{t("paint.sortModified")}</option>
            <option value="name">{t("paint.sortName")}</option>
            <option value="created">{t("paint.sortCreated")}</option>
          </select>
        </div>
      )}

      <div className="paint-pages-scroll">
        {groups.length === 0 ? (
          !sidebarCollapsed && <p className="muted paint-pages-empty">{t("paint.noPagesFound")}</p>
        ) : (
          groups.map((g) =>
            multiGroup ? (
              <div className={"page-group" + (g.active ? " active-group" : "")} key={g.key}>
                {!sidebarCollapsed && (
                  <button
                    className="page-group-head"
                    onClick={() => setGroupCollapsed((c) => ({ ...c, [g.key]: !isGroupCollapsed(g) }))}
                    aria-expanded={!isGroupCollapsed(g)}
                  >
                    <span className="page-group-caret">{isGroupCollapsed(g) ? "▸" : "▾"}</span>
                    <span className="page-group-name">{g.label}</span>
                    <span className="page-group-count">{g.items.length}</span>
                  </button>
                )}
                {(sidebarCollapsed || !isGroupCollapsed(g)) && <ul className="page-list">{g.items.map(renderItem)}</ul>}
              </div>
            ) : (
              <ul className="page-list" key={g.key}>{g.items.map(renderItem)}</ul>
            )
          )
        )}
      </div>
    </aside>
  );
}
