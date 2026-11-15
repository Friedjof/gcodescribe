import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PageGroup, PageIndex, PageMeta } from "../../api";
import PageThumbnail from "./PageThumbnail";

type Dragged = { kind: "slide" | "folder"; id: string };

export default function ProjectPagePanel({ index, activePageId, onOpenProjects, onOpen, onNew,
  onRename, onDuplicate, onRemove, onReorder, onCreateGroup, onRenameGroup, onDeleteGroup,
  onSetPageGroup, onSetGroupParent, onMove, sidebarCollapsed, onToggleSidebar }: {
  index: PageIndex;
  activePageId: string;
  onOpenProjects: () => void;
  onOpen: (id: string) => void;
  onNew: (folderId?: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onCreateGroup: (name: string, parentId?: string | null) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onSetPageGroup: (id: string, groupId: string | null) => void;
  onSetGroupParent: (id: string, parentId: string | null) => void;
  onMove: (id: string) => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"manual" | "name" | "modified">("manual");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<Dragged | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    setSelectedFolder(null); setClosed({}); setQuery(""); setMenu(null);
  }, [index.project?.id]);
  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: "nearest" }); }, [activePageId]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.anchor.contains(target) && !menuRef.current?.contains(target)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    const closeOnScroll = () => setMenu(null);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
    };
  }, [menu]);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const anchor = menu.anchor.getBoundingClientRect();
    const popup = menuRef.current.getBoundingClientRect();
    const below = anchor.bottom + 4;
    const top = below + popup.height <= window.innerHeight - 8
      ? below : Math.max(8, anchor.top - popup.height - 4);
    const left = Math.max(8, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 8));
    setMenuPosition({ top, left });
  }, [menu]);

  const groups = index.groups ?? [];
  const pages = index.order;
  const search = query.trim().toLocaleLowerCase();
  const canDrag = sort === "manual" && !search && !sidebarCollapsed;
  const folderName = selectedFolder ? groups.find((g) => g.id === selectedFolder)?.name : null;
  const selectedLocation = folderName ?? "Projekt";
  const children = (parentId: string | null) => groups.filter((g) => (g.parentId ?? null) === parentId);
  const directPages = (folderId: string | null, showAll = false) => {
    const matching = pages.filter((page) => (page.groupId ?? null) === folderId &&
      (showAll || !search || page.name.toLocaleLowerCase().includes(search)));
    return sort === "manual" ? matching : [...matching].sort((a, b) => sort === "name"
      ? a.name.localeCompare(b.name) : b.modified - a.modified);
  };
  const folderHasMatch = (folder: PageGroup): boolean => !search ||
    folder.name.toLocaleLowerCase().includes(search) ||
    directPages(folder.id).length > 0 || children(folder.id).some(folderHasMatch);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    const count = (id: string): number => {
      if (result.has(id)) return result.get(id)!;
      const total = pages.filter((page) => page.groupId === id).length +
        groups.filter((group) => group.parentId === id).reduce((sum, group) => sum + count(group.id), 0);
      result.set(id, total);
      return total;
    };
    groups.forEach((group) => count(group.id));
    return result;
  }, [groups, pages]);

  const startFolder = (parentId: string | null) => {
    setNewFolderParent(parentId); setNewFolderName(""); setMenu(null);
  };
  const submitFolder = () => {
    const name = newFolderName.trim();
    if (name) onCreateGroup(name, newFolderParent);
    setNewFolderParent(undefined); setNewFolderName("");
  };
  const moveBefore = (targetId: string) => {
    if (!drag || drag.kind !== "slide" || drag.id === targetId || !canDrag) return;
    const destination = pages.find((page) => page.id === targetId);
    const source = pages.find((page) => page.id === drag.id);
    if (!destination || !source) return;
    if ((destination.groupId ?? null) !== (source.groupId ?? null)) {
      onSetPageGroup(source.id, destination.groupId ?? null);
      return;
    }
    const ids = pages.map((page) => page.id).filter((id) => id !== source.id);
    ids.splice(ids.indexOf(targetId), 0, source.id);
    onReorder(ids);
  };
  const dropInto = (folderId: string | null) => {
    if (drag?.kind === "slide") onSetPageGroup(drag.id, folderId);
    if (drag?.kind === "folder" && drag.id !== folderId) onSetGroupParent(drag.id, folderId);
    setDrag(null); setDropTarget(null);
  };
  const action = (callback: () => void) => { setMenu(null); callback(); };
  const toggleMenu = (id: string, anchor: HTMLElement) => {
    setMenuPosition(null);
    setMenu((current) => current?.id === id ? null : { id, anchor });
  };
  const popover = (id: string, items: ReactNode) => menu?.id === id && createPortal(
    <div ref={menuRef} className="project-menu-popover" role="menu"
      style={menuPosition ?? { top: 0, left: 0, visibility: "hidden" }}>{items}</div>, document.body);

  const renderPage = (page: PageMeta) => {
    const active = page.id === activePageId;
    const menuId = `slide:${page.id}`;
    return <li key={page.id} ref={active ? activeRef : undefined}
      className={`project-slide${active ? " active" : ""}${dropTarget === page.id ? " drop-before" : ""}`}
      draggable={canDrag} onDragStart={canDrag ? () => setDrag({ kind: "slide", id: page.id }) : undefined}
      onDragEnd={() => { setDrag(null); setDropTarget(null); }}
      onDragOver={(event) => { if (canDrag && drag?.kind === "slide" && drag.id !== page.id) {
        event.preventDefault(); setDropTarget(page.id);
      } }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); moveBefore(page.id); setDrag(null); setDropTarget(null); }}>
      <button className="project-slide-open" title={page.name} aria-label={page.name}
        onClick={() => { setSelectedFolder(page.groupId ?? null); onOpen(page.id); }}>
        <PageThumbnail page={page} />
        {!sidebarCollapsed && <span className="project-slide-info">
          <strong>{page.name}</strong>
          <small>{page.objectCount === 0 ? "Leerer Slide" : `${page.objectCount} Objekte`}</small>
        </span>}
      </button>
      {!sidebarCollapsed && <div className="project-action-menu" data-project-action-menu>
        <button className="project-more" title={`Aktionen für ${page.name}`} aria-label={`Aktionen für ${page.name}`}
          aria-haspopup="menu" aria-expanded={menu?.id === menuId}
          onClick={(event) => toggleMenu(menuId, event.currentTarget)}>⋯</button>
        {popover(menuId, <>
          <button role="menuitem" onClick={() => action(() => onRename(page.id, page.name))}>Umbenennen</button>
          <button role="menuitem" onClick={() => action(() => onDuplicate(page.id))}>Duplizieren</button>
          <button role="menuitem" onClick={() => action(() => onMove(page.id))}>In anderes Projekt verschieben</button>
          {page.groupId && <button role="menuitem" onClick={() => action(() => onSetPageGroup(page.id, null))}>Aus Ordner nehmen</button>}
          <button role="menuitem" className="danger" onClick={() => action(() => onRemove(page.id))}>Löschen</button>
        </>)}
      </div>}
    </li>;
  };
  const renderFolder = (folder: PageGroup, depth: number): ReactNode => {
    if (!folderHasMatch(folder)) return null;
    const folderId = folder.id;
    const menuId = `folder:${folderId}`;
    const isClosed = !search && closed[folderId];
    const showAll = !!search && folder.name.toLocaleLowerCase().includes(search);
    return <section key={folderId} className="project-folder" style={{ "--folder-depth": depth } as CSSProperties}>
      <div className={`project-folder-head${selectedFolder === folderId ? " selected" : ""}${dropTarget === folderId ? " drop-into" : ""}`}
        draggable={canDrag} onDragStart={canDrag ? () => setDrag({ kind: "folder", id: folderId }) : undefined}
        onDragEnd={() => { setDrag(null); setDropTarget(null); }}
        onDragOver={(event) => { if (canDrag && drag?.id !== folderId) { event.preventDefault(); setDropTarget(folderId); } }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dropInto(folderId); }}>
        <button className="project-folder-caret" aria-label={`${folder.name} ${isClosed ? "öffnen" : "schließen"}`}
          onClick={() => setClosed((value) => ({ ...value, [folderId]: !value[folderId] }))}>{isClosed ? "▸" : "▾"}</button>
        <button className="project-folder-open" title={folder.name} aria-label={folder.name}
          onClick={() => { setSelectedFolder(folderId); setClosed((value) => ({ ...value, [folderId]: false })); }}>
          <span aria-hidden="true">▱</span><span className="project-folder-name">{folder.name}</span>
          <small>{counts.get(folderId) ?? 0}</small>
        </button>
        <div className="project-action-menu" data-project-action-menu>
          <button className="project-more" title={`Aktionen für Ordner ${folder.name}`} aria-label={`Aktionen für Ordner ${folder.name}`}
            aria-haspopup="menu" aria-expanded={menu?.id === menuId}
            onClick={(event) => toggleMenu(menuId, event.currentTarget)}>⋯</button>
          {popover(menuId, <>
            <button role="menuitem" onClick={() => action(() => onNew(folderId))}>Slide hier erstellen</button>
            <button role="menuitem" onClick={() => action(() => startFolder(folderId))}>Unterordner erstellen</button>
            <button role="menuitem" onClick={() => action(() => onRenameGroup(folderId, folder.name))}>Umbenennen</button>
            <button role="menuitem" className="danger" onClick={() => action(() => onDeleteGroup(folderId))}>Ordner löschen</button>
          </>)}
        </div>
      </div>
      {!isClosed && <div className="project-folder-contents">
        {children(folderId).map((child) => renderFolder(child, depth + 1))}
        <ul className="project-slide-list">{directPages(folderId, showAll).map(renderPage)}</ul>
      </div>}
    </section>;
  };

  return <aside className={`paint-pages project-pages${sidebarCollapsed ? " collapsed" : ""}`}>
    <div className="project-sidebar-head">
      <button className="project-switch" onClick={onOpenProjects} title="Projektübersicht öffnen"
        aria-label={`Projektübersicht öffnen: ${index.project?.name ?? "Projekt"}`}>
        <span className="project-switch-icon" aria-hidden="true">▤</span>
        {!sidebarCollapsed && <><span className="project-switch-text"><strong>{index.project?.name ?? "Projekt"}</strong>
          <small>{index.activeProfile?.name ?? "Projektprofil"}</small></span><span aria-hidden="true">⌄</span></>}
      </button>
      <button className="ghost tiny pages-collapse-btn" onClick={onToggleSidebar}
        aria-label={sidebarCollapsed ? "Leiste öffnen" : "Leiste schließen"}
        title={sidebarCollapsed ? "Leiste öffnen" : "Leiste schließen"}>{sidebarCollapsed ? "▶" : "◀"}</button>
    </div>
    {!sidebarCollapsed && <>
      <div className="project-pages-tools">
        <button className="primary" onClick={() => onNew(selectedFolder)}>＋ Slide</button>
        <button className="ghost" onClick={() => startFolder(selectedFolder)}>＋ Ordner</button>
      </div>
      <p className="project-target-label">Neue Elemente in <strong>{selectedLocation}</strong></p>
      {newFolderParent !== undefined && <form className="project-folder-create" onSubmit={(event) => { event.preventDefault(); submitFolder(); }}>
        <input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)}
          placeholder={`Ordner in ${groups.find((group) => group.id === newFolderParent)?.name ?? "Projekt"}`}
          aria-label="Ordnername" onKeyDown={(event) => { if (event.key === "Escape") setNewFolderParent(undefined); }} />
        <button type="submit" disabled={!newFolderName.trim()}>Anlegen</button>
        <button type="button" className="ghost" aria-label="Abbrechen" onClick={() => setNewFolderParent(undefined)}>×</button>
      </form>}
      <div className="paint-pages-controls project-pages-controls">
        <input className="paint-pages-search" type="search" placeholder="Slides suchen…" aria-label="Slides suchen"
          value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="paint-pages-sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Slides sortieren">
          <option value="manual">Manuell</option><option value="name">Name</option><option value="modified">Zuletzt geändert</option>
        </select>
      </div>
      <p className="project-slide-count">{pages.length} {pages.length === 1 ? "Slide" : "Slides"}</p>
    </>}
    <div className="paint-pages-scroll project-pages-tree">
      {sidebarCollapsed ? <ul className="project-slide-list">{pages.map(renderPage)}</ul> : <>
        <div className={`project-root-row${selectedFolder === null ? " selected" : ""}${dropTarget === "root" ? " drop-into" : ""}`}
          onDragOver={(event) => { if (canDrag && drag) { event.preventDefault(); setDropTarget("root"); } }}
          onDrop={(event) => { event.preventDefault(); dropInto(null); }}>
          <button onClick={() => setSelectedFolder(null)}><span aria-hidden="true">▤</span> Projekt
            <small>{pages.filter((page) => !page.groupId).length}</small></button>
        </div>
        {children(null).map((folder) => renderFolder(folder, 0))}
        <ul className="project-slide-list project-root-slides">{directPages(null).map(renderPage)}</ul>
        {search && !pages.some((page) => page.name.toLocaleLowerCase().includes(search)) &&
          !groups.some((group) => group.name.toLocaleLowerCase().includes(search)) &&
          <p className="paint-pages-empty muted">Keine Slides gefunden.</p>}
      </>}
    </div>
  </aside>;
}
