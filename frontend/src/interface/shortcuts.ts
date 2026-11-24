export type Command = "settings" | "help" | "shortcuts" | "newSlide" | "newProject" | "open" | "save" | "export" | "plot" | "preview" | "search" | "rename" | "selectAll" | "deselect" | "zoomIn" | "zoomOut" | "fit" | "sidebar";
export const shortcutLabels: Record<Command, string> = {
  settings: "Ctrl+,", help: "F1", shortcuts: "Ctrl+?", newSlide: "Ctrl+N", newProject: "Ctrl+Shift+N",
  open: "Ctrl+O", save: "Ctrl+S", export: "Ctrl+Shift+E", plot: "Ctrl+P", preview: "Ctrl+Shift+P",
  search: "Ctrl+F", rename: "F2", selectAll: "Ctrl+A", deselect: "Ctrl+Shift+A",
  zoomIn: "Ctrl++", zoomOut: "Ctrl+-", fit: "Ctrl+0", sidebar: "F9",
};
export function matchesCommand(event: KeyboardEvent, command: Command) {
  if (event.altKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (["help", "rename", "sidebar"].includes(command))
    return !event.ctrlKey && !event.shiftKey && key === ({ help: "f1", rename: "f2", sidebar: "f9" } as Record<string, string>)[command];
  if (!event.ctrlKey) return false;
  if (command === "zoomIn") return key === "+" || key === "=" || event.code === "NumpadAdd";
  if (command === "shortcuts") return key === "?" || (key === "/" && event.shiftKey);
  const bindings: Partial<Record<Command, [string, boolean]>> = {
    settings: [",", false], newSlide: ["n", false], newProject: ["n", true], open: ["o", false],
    save: ["s", false], export: ["e", true], plot: ["p", false], preview: ["p", true], search: ["f", false],
    selectAll: ["a", false], deselect: ["a", true], zoomOut: ["-", false], fit: ["0", false],
  };
  const binding = bindings[command];
  return !!binding && key === binding[0] && event.shiftKey === binding[1];
}
export function elementVisible(element: Element) {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}
export function shortcutScope(event: KeyboardEvent, root?: HTMLElement | SVGElement | null, input = false) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || (root && !elementVisible(root))) return false;
  const target = event.target instanceof Element ? event.target : document.activeElement;
  const control = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  const nonText = control instanceof HTMLInputElement && ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(control.type);
  if (!input && control && !nonText) return false;
  if (target?.closest('[role="menu"], [role="separator"]')) return false;
  const modals = Array.from(document.querySelectorAll('[aria-modal="true"], dialog[open]')).filter(elementVisible);
  const modal = modals[modals.length - 1];
  return !modal || !!root && modal.contains(root);
}
