/** Stable workspace IDs also serve as preference keys; labels may evolve. */
export const WORKSPACE_IDS = ["start", "paint", "games", "gallery", "convert", "paper", "calibrate", "control", "font", "ai"] as const;
export type WorkspaceId = typeof WORKSPACE_IDS[number];
export interface WorkspaceDefinition {
  id: WorkspaceId;
  label: string;
  description: string;
  primary: boolean;
  keepAlive: boolean;
  capability?: "ai";
}
export const WORKSPACES: readonly WorkspaceDefinition[] = [
  { id: "start", label: "workspace.start", description: "workspace.startHint", primary: true, keepAlive: true },
  { id: "paint", label: "workspace.paint", description: "workspace.paintHint", primary: true, keepAlive: true },
  { id: "games", label: "workspace.games", description: "workspace.gamesHint", primary: true, keepAlive: true },
  { id: "gallery", label: "workspace.gallery", description: "workspace.galleryHint", primary: false, keepAlive: true },
  { id: "convert", label: "workspace.convert", description: "workspace.convertHint", primary: true, keepAlive: true },
  { id: "paper", label: "workspace.paper", description: "workspace.paperHint", primary: true, keepAlive: true },
  { id: "calibrate", label: "workspace.calibrate", description: "workspace.calibrateHint", primary: false, keepAlive: true },
  { id: "control", label: "workspace.control", description: "workspace.controlHint", primary: false, keepAlive: false },
  { id: "font", label: "workspace.font", description: "workspace.fontHint", primary: false, keepAlive: true },
  { id: "ai", label: "workspace.ai", description: "workspace.aiHint", primary: false, keepAlive: true, capability: "ai" },
];
export const DEFAULT_VISIBLE: readonly WorkspaceId[] = ["start", "paint", "games", "convert", "paper"];
export const isWorkspaceId = (value: unknown): value is WorkspaceId => typeof value === "string" && (WORKSPACE_IDS as readonly string[]).includes(value);
export const workspaceAvailable = (workspace: WorkspaceDefinition, aiEnabled: boolean) => workspace.capability !== "ai" || aiEnabled;
export const workspaceById = (id: WorkspaceId): WorkspaceDefinition => WORKSPACES.find(workspace => workspace.id === id)!;
export function visibleWorkspaces(order: readonly WorkspaceId[], visible: readonly WorkspaceId[], aiEnabled: boolean) {
  const shown = new Set(visible);
  const result = order.map(workspaceById).filter(workspace => shown.has(workspace.id) && workspaceAvailable(workspace, aiEnabled));
  return result.length ? result : [workspaceById("start")];
}
export function usableWorkspace(active: WorkspaceId, order: readonly WorkspaceId[], visible: readonly WorkspaceId[], aiEnabled: boolean): WorkspaceId {
  const available = visibleWorkspaces(order, visible, aiEnabled);
  if (available.some(workspace => workspace.id === active)) return active;
  const index = order.indexOf(active);
  const following = available.find(workspace => order.indexOf(workspace.id) >= index);
  return following?.id ?? available[available.length - 1]?.id ?? "start";
}
