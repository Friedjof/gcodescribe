import type { WorkspaceId } from "./workspaces";
/** Preserve preference order and keep the active workspace reachable at any width. */
export function fitWorkspaceTabs(
  ids: readonly WorkspaceId[],
  widths: readonly number[],
  available: number,
  overflowWidth: number,
  active: WorkspaceId,
) {
  if (
    available <= 0 ||
    widths.some((width) => width <= 0) ||
    widths.reduce((sum, width) => sum + width, 0) <= available
  )
    return [...ids];
  const budget = Math.max(0, available - overflowWidth),
    shown: WorkspaceId[] = [];
  let occupied = 0;
  for (let i = 0; i < ids.length; i++) {
    if (occupied + widths[i] > budget) break;
    shown.push(ids[i]);
    occupied += widths[i];
  }
  if (!shown.includes(active) && ids.includes(active)) {
    const width = widths[ids.indexOf(active)];
    while (shown.length && occupied + width > budget) {
      const removed = shown.pop()!;
      occupied -= widths[ids.indexOf(removed)];
    }
    shown.push(active);
  }
  return ids.filter((id) => shown.includes(id));
}
