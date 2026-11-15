import { useEffect } from "react";
import type { Page } from "../../../api";
import type { Tool } from "../PaintCanvas";
import type { ObjectOps } from "./useObjectOps";

/** Global keyboard shortcuts of the paint editor: Escape (tool/selection),
 * live text editing, arrow nudge, delete, copy/cut/paste/duplicate and
 * undo/redo. Skips inputs/textareas and stays inactive while the view is
 * hidden or the coloring overlay is open. */
export function usePaintShortcuts({
  active,
  tool,
  setTool,
  selectedIds,
  setSelectedIds,
  closeMenu,
  ops,
  page,
  defaultText,
}: {
  active: boolean;
  tool: Tool;
  setTool: (tool: Tool) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  closeMenu: () => void;
  ops: ObjectOps;
  page: Page | null;
  defaultText: string;
}) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("select, [role='menu'], [role='separator'], [role='tablist'], [role='dialog']")) return;
      if (target?.closest("button, a") && !(e.ctrlKey || e.metaKey)) return;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        if (tool !== "select") { setTool("select"); return; }
        if (selectedIds.length > 0) setSelectedIds([]);
        return;
      }
      if (tool === "text" && selectedIds.length === 1 && !(e.ctrlKey || e.metaKey || e.altKey)) {
        if (e.key === "Backspace") {
          if (ops.editSelectedText((text) => text.slice(0, -1))) e.preventDefault();
          return;
        }
        if (e.key === "Enter") {
          if (ops.editSelectedText((text) => `${text}\n`)) e.preventDefault();
          return;
        }
        if (e.key.length === 1) {
          if (ops.editSelectedText((text) => text === defaultText ? e.key : text + e.key)) e.preventDefault();
          return;
        }
      }
      const arrow: Record<string, [number, number]> = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      };
      if (arrow[e.key] && selectedIds.length > 0 && !(e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        if (!e.repeat) ops.remember();
        const step = page?.grid.step || 1;
        const [sx, sy] = arrow[e.key];
        ops.nudgeSelected(sx * step, sy * step);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0) {
        e.preventDefault();
        ops.deleteSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { e.preventDefault(); ops.copySelected(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") { e.preventDefault(); ops.cutSelected(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") { e.preventDefault(); ops.pasteObjects(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); ops.duplicateSelected(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) ops.redo(); else ops.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); ops.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
