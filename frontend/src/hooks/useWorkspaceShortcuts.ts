import { useEffect, useRef } from "react";
import type { WorkspaceDefinition, WorkspaceId } from "../interface/workspaces";

function hasVisibleModal() {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open]')).some(dialog => {
    for (let node: HTMLElement | null = dialog; node; node = node.parentElement) {
      if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  });
}

/** Cycle the configured workspace order, including tabs in the overflow menu. */
export function useWorkspaceShortcuts({ workspaces, active, enabled, onChange }: {
  workspaces: readonly WorkspaceDefinition[];
  active: WorkspaceId;
  enabled: boolean;
  onChange: (workspace: WorkspaceId) => void;
}) {
  // Native GTK forwarding creates a DOM event without an IME composition flag.
  const composing = useRef(false);
  useEffect(() => {
    const start = () => { composing.current = true; };
    const end = () => { composing.current = false; };
    document.addEventListener("compositionstart", start, true);
    document.addEventListener("compositionend", end, true);
    window.addEventListener("blur", end);
    return () => {
      document.removeEventListener("compositionstart", start, true);
      document.removeEventListener("compositionend", end, true);
      window.removeEventListener("blur", end);
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || composing.current || event.metaKey) return;
      const direct = event.altKey && !event.ctrlKey && !event.shiftKey && /^[1-9]$/.test(event.key)
        ? Number(event.key) === 9 ? workspaces.length - 1 : Number(event.key) - 1 : -1;
      if (event.altKey && direct < 0) return;
      const direction = event.ctrlKey && event.key === "Tab" ? (event.shiftKey ? -1 : 1)
        : event.ctrlKey && !event.shiftKey && event.key === "PageDown" ? 1
        : event.ctrlKey && !event.shiftKey && event.key === "PageUp" ? -1 : 0;
      if (!direction && direct < 0) return;
      if (workspaces.length < 2 || hasVisibleModal()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="menu"], [role="dialog"], [role="alertdialog"]')) return;
      if (direct >= workspaces.length) return;
      event.preventDefault();
      if (direct >= 0) { if (workspaces[direct]) onChange(workspaces[direct].id); return; }
      const index = workspaces.findIndex(workspace => workspace.id === active);
      const next = index < 0 ? direction < 0 ? workspaces.length - 1 : 0
        : (index + direction + workspaces.length) % workspaces.length;
      onChange(workspaces[next].id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, enabled, onChange, workspaces]);
}
