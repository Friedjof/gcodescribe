import { useEffect, useRef, type RefObject } from "react";
import { elementVisible, matchesCommand, shortcutScope, type Command } from "../interface/shortcuts";
export interface ShortcutAction { command: Command; run: () => void; disabled?: boolean; input?: boolean }
interface Scope { actions: ShortcutAction[]; enabled: boolean; root?: RefObject<HTMLElement | SVGElement> }
const scopes = new Set<() => Scope>();
let composing = false;
const start = () => { composing = true; };
const end = () => { composing = false; };
function depth(node?: Element | null) {
  let result = 0;
  for (; node; node = node.parentElement) result++;
  return result;
}
function dispatch(event: Event) {
  if (composing || event.defaultPrevented) return;
  const keyboard = event as KeyboardEvent;
  const command = event.type === "gcs:command" ? (event as CustomEvent<Command>).detail : null;
  const candidates = Array.from(scopes, read => read()).flatMap(scope => {
    if (!scope.enabled || scope.root && !scope.root.current) return [];
    const action = scope.actions.find(action => command ? action.command === command : matchesCommand(keyboard, action.command));
    if (!action || !shortcutScope(keyboard, scope.root?.current, command ? true : action.input)) return [];
    const target = event.target instanceof Node ? event.target : document.activeElement;
    return [{ action, priority: depth(scope.root?.current) + (target && scope.root?.current?.contains(target) ? 1000 : 0) }];
  }).sort((a, b) => b.priority - a.priority);
  const action = candidates[0]?.action;
  if (!action) return;
  event.preventDefault();
  if (!action.disabled && (!keyboard.repeat || ["zoomIn", "zoomOut"].includes(action.command))) action.run();
}
function listen(add: boolean) {
  if (add) {
    document.addEventListener("compositionstart", start, true); document.addEventListener("compositionend", end, true);
    window.addEventListener("blur", end); window.addEventListener("keydown", dispatch); window.addEventListener("gcs:command", dispatch);
  } else {
    document.removeEventListener("compositionstart", start, true); document.removeEventListener("compositionend", end, true);
    window.removeEventListener("blur", end); window.removeEventListener("keydown", dispatch); window.removeEventListener("gcs:command", dispatch);
    composing = false;
  }
}
export function executeCommand(command: Command) {
  return !(document.activeElement ?? document.body).dispatchEvent(new CustomEvent("gcs:command", { detail: command, bubbles: true, cancelable: true }));
}
export function commandAvailable(command: Command) {
  const candidates = Array.from(scopes, read => read()).filter(scope => scope.enabled && (!scope.root || !!scope.root.current && elementVisible(scope.root.current)))
    .flatMap(scope => { const action = scope.actions.find(action => action.command === command); return action ? [{action,priority:depth(scope.root?.current)}] : []; })
    .sort((a,b) => b.priority-a.priority);
  return !!candidates[0] && !candidates[0].action.disabled;
}
export function useCommandShortcuts(actions: ShortcutAction[], enabled = true, root?: RefObject<HTMLElement | SVGElement>) {
  const latest = useRef<Scope>({ actions, enabled, root }); latest.current = { actions, enabled, root };
  useEffect(() => {
    const read = () => latest.current;
    if (!scopes.size) listen(true);
    scopes.add(read);
    return () => { scopes.delete(read); if (!scopes.size) listen(false); };
  }, []);
}
