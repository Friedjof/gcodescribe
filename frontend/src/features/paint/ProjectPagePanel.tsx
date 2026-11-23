import { useI18n } from "../../i18n";
import PaginationBar from "../../components/paging/PaginationBar";
import { useFitListPage } from "../../components/paging/useFitListPage";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PageGroup, PageIndex, PageMeta } from "../../api";
import PageThumbnail from "./PageThumbnail";
import EditorIcon from "../../components/editor/EditorIcon";

type Dragged = { kind: "slide" | "folder"; id: string };

export default function ProjectPagePanel({ index, activePageId, onOpenProjects, onOpen, onNew,
  onRename, onDuplicate, onRemove, onReorder, onCreateGroup, onRenameGroup, onDeleteGroup,
  onSetPageGroup, onSetGroupParent, onMove, sidebarCollapsed, onToggleSidebar, loadingPageId }: {
  index: PageIndex;
  activePageId: string;
  loadingPageId?: string | null;
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
  const { t } = useI18n();
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

  useEffect(() => {
    setSelectedFolder(null); setClosed({}); setQuery(""); setMenu(null);
  }, [index.project?.id]);
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
  const selectedLocation = folderName ?? t("setup.projectSelect");
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
    return <li key={page.id}
      className={`project-slide${active ? " active" : ""}${loadingPageId === page.id ? " loading" : ""}${dropTarget === page.id ? " drop-before" : ""}`}
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
          <small>{loadingPageId === page.id ? t("projects.loading") : page.objectCount === 0 ? t("projects.emptySlide") : t(page.objectCount === 1 ? "projects.oneObject" : "projects.objectCount", {count:page.objectCount})}</small>
        </span>}
      </button>
      {!sidebarCollapsed && <div className="project-slide-actions" role="group" aria-label={t("projects.editSlide",{name:page.name})}>
        <button type="button" title={t("profiles.renameAction")} aria-label={t("projects.renameNamed",{name:page.name})} onClick={() => onRename(page.id, page.name)}><EditorIcon name="text" size={13}/></button>
        <button type="button" title={t("fontEditor.variantDuplicate")} aria-label={t("projects.duplicateNamed",{name:page.name})} onClick={() => onDuplicate(page.id)}><EditorIcon name="copy" size={13}/></button>
        <button type="button" title={t("projects.moveToAnotherProject")} aria-label={t("projects.moveNamed",{name:page.name})} onClick={() => onMove(page.id)}><EditorIcon name="folder" size={13}/></button>
        {page.groupId && <button type="button" title={t("projects.removeFromFolder")} aria-label={t("projects.removeNamed",{name:page.name})} onClick={() => onSetPageGroup(page.id, null)}><EditorIcon name="previous" size={13}/></button>}
        <button type="button" className="danger" title={t("common.delete")} aria-label={t("projects.deleteNamed",{name:page.name})} onClick={() => onRemove(page.id)}><EditorIcon name="trash" size={13}/></button>
      </div>}
    </li>;
  };
  const renderFolder = (folder: PageGroup, depth: number): ReactNode => {
    if (!folderHasMatch(folder)) return null;
    const folderId = folder.id;
    const menuId = `folder:${folderId}`;
    const isClosed = !search && closed[folderId];
    return <section key={folderId} className="project-folder" style={{ "--folder-depth": depth } as CSSProperties}>
      <div className={`project-folder-head${selectedFolder === folderId ? " selected" : ""}${dropTarget === folderId ? " drop-into" : ""}`}
        draggable={canDrag} onDragStart={canDrag ? () => setDrag({ kind: "folder", id: folderId }) : undefined}
        onDragEnd={() => { setDrag(null); setDropTarget(null); }}
        onDragOver={(event) => { if (canDrag && drag?.id !== folderId) { event.preventDefault(); setDropTarget(folderId); } }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); dropInto(folderId); }}>
        <button className="project-folder-caret" aria-label={t(isClosed?"projects.openFolder":"projects.closeFolder",{name:folder.name})}
          onClick={() => setClosed((value) => ({ ...value, [folderId]: !value[folderId] }))}>{isClosed ? "▸" : "▾"}</button>
        <button className="project-folder-open" title={folder.name} aria-label={folder.name}
          onClick={() => { setSelectedFolder(folderId); setClosed((value) => ({ ...value, [folderId]: false })); }}>
          <span aria-hidden="true">▱</span><span className="project-folder-name">{folder.name}</span>
          <small>{counts.get(folderId) ?? 0}</small>
        </button>
        <div className="project-action-menu" data-project-action-menu>
          <button className="project-more" title={t("projects.folderActions",{name:folder.name})} aria-label={t("projects.folderActions",{name:folder.name})}
            aria-haspopup="menu" aria-expanded={menu?.id === menuId}
            onClick={(event) => toggleMenu(menuId, event.currentTarget)}>⋯</button>
          {popover(menuId, <>
            <button role="menuitem" onClick={() => action(() => onNew(folderId))}>{t("projects.createSlideHere")}</button>
            <button role="menuitem" onClick={() => action(() => startFolder(folderId))}>{t("projects.createSubfolder")}</button>
            <button role="menuitem" onClick={() => action(() => onRenameGroup(folderId, folder.name))}>{t("profiles.renameAction")}</button>
            <button role="menuitem" className="danger" onClick={() => action(() => onDeleteGroup(folderId))}>{t("paint.deleteGroup")}</button>
          </>)}
        </div>
      </div>

    </section>;
  };

  type TreeRow = { kind: "folder"; folder: PageGroup; depth: number } | { kind: "page"; page: PageMeta; depth: number };
  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number, inheritedMatch = false) => {
    children(parentId).forEach((folder) => {
      if (visited.has(folder.id) || (!inheritedMatch && !folderHasMatch(folder))) return;
      visited.add(folder.id);
      rows.push({ kind: "folder", folder, depth });
      if (search || !closed[folder.id]) visit(folder.id, depth + 1, inheritedMatch || (!!search && folder.name.toLocaleLowerCase().includes(search)));
    });
    directPages(parentId, inheritedMatch).forEach((page) => rows.push({ kind: "page", page, depth }));
  };
  if (sidebarCollapsed) pages.forEach((page) => rows.push({ kind: "page", page, depth: 0 }));
  else visit(null, 0);
  const paging = useFitListPage(rows, 54, 6);
  useEffect(() => {
    const active = rows.findIndex((row) => row.kind === "page" && row.page.id === activePageId);
    if (active >= 0) paging.setPage(Math.floor(active / paging.size));
  }, [activePageId, paging.size, index.project?.id]);
  useEffect(() => { setMenu(null); }, [paging.page]);

  return <aside className={`paint-pages project-pages${sidebarCollapsed ? " collapsed" : ""}`}>
    <div className="project-sidebar-head">
      <button className="project-switch" onClick={onOpenProjects} title={t("projects.openProjectOverview")}
        aria-haspopup="dialog"
        aria-label={t("projects.openNamedOverview",{name:index.project?.name??t("setup.projectSelect")})}>
        <span className="project-switch-icon" aria-hidden="true">▤</span>
        {!sidebarCollapsed && <><span className="project-switch-text"><strong>{index.project?.name ?? t("setup.projectSelect")}</strong>
          <small>{index.activeProfile?.name ?? t("projects.defaultProfile")}</small></span><EditorIcon name="open" size={14} /></>}
      </button>
      <button className="ghost tiny pages-collapse-btn" onClick={onToggleSidebar}
        aria-label={t(sidebarCollapsed ? "projects.openPanel" : "projects.closePanel")}
        title={t(sidebarCollapsed ? "projects.openPanel" : "projects.closePanel")}>{sidebarCollapsed ? "▶" : "◀"}</button>
    </div>
    {!sidebarCollapsed && <>
      <div className="project-pages-tools">
        <button className="primary" onClick={() => onNew(selectedFolder)}>{t("projects.slide")}</button>
        <button className="ghost" onClick={() => startFolder(selectedFolder)}>{t("projects.folder")}</button>
      </div>
      <p className="project-target-label">{t("projects.newItemsIn")} <strong>{selectedLocation}</strong></p>
      {newFolderParent !== undefined && <form className="project-folder-create" onSubmit={(event) => { event.preventDefault(); submitFolder(); }}>
        <input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)}
          placeholder={t("projects.folderIn",{name:groups.find((group)=>group.id===newFolderParent)?.name??t("setup.projectSelect")})}
          aria-label={t("paint.groupNamePrompt")} onKeyDown={(event) => { if (event.key === "Escape") setNewFolderParent(undefined); }} />
        <button type="submit" disabled={!newFolderName.trim()}>{t("fontEditor.create")}</button>
        <button type="button" className="ghost" aria-label={t("common.cancel")} onClick={() => setNewFolderParent(undefined)}>×</button>
      </form>}
      <div className="paint-pages-controls project-pages-controls">
        <input className="paint-pages-search" type="search" placeholder={t("projects.searchSlides")} aria-label={t("projects.searchSlides")}
          value={query} onChange={(event) => { setQuery(event.target.value); paging.setPage(0); }} />
        <select className="paint-pages-sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label={t("projects.sortSlides")}>
          <option value="manual">{t("projects.manual")}</option><option value="name">{t("projects.name")}</option><option value="modified">{t("projects.lastModified")}</option>
        </select>
      </div>
      <p className="project-slide-count">{pages.length} {t(pages.length === 1 ? "projects.oneSlide" : "projects.slides")}</p>
    </>}
    {!sidebarCollapsed && <div className={`project-root-row${selectedFolder === null ? " selected" : ""}${dropTarget === "root" ? " drop-into" : ""}`}
      onDragOver={(event) => { if (canDrag && drag) { event.preventDefault(); setDropTarget("root"); } }}
      onDrop={(event) => { event.preventDefault(); dropInto(null); }}>
      <button onClick={() => setSelectedFolder(null)}><span aria-hidden="true">▤</span>  {t("setup.projectSelect")}<small>{pages.filter((page) => !page.groupId).length}</small></button>
    </div>}
    <div className="paint-pages-scroll project-pages-tree" ref={paging.viewport}>
      {paging.items.map((row) => <div className="project-tree-row" key={row.kind === "folder" ? `folder:${row.folder.id}` : row.page.id} style={{ paddingLeft: sidebarCollapsed ? 0 : Math.min(40, row.depth * 10) }}>
        {row.kind === "folder" ? renderFolder(row.folder, row.depth) : <ul className="project-slide-list">{renderPage(row.page)}</ul>}
      </div>)}
      {search && rows.length === 0 && <p className="paint-pages-empty muted">{t("projects.noSlidesFound")}</p>}
    </div>
    <PaginationBar page={paging.page} pages={paging.pages} onChange={paging.setPage} label={t("projects.slides")} dragPaging={!!drag}/>
  </aside>;
}
