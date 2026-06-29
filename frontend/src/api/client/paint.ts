import { req } from "./req";
import type { Page, PageIndex, PageScore, SceneObject, ColoringApiItem } from "../types/paint";
import type { Job, GcodePreview3D } from "../types/jobs";
import type { ProfileRef } from "../types/calibration";

export const paintClient = {
  listPages: () => req<PageIndex>("/api/pages"),
  getPage: (id: string) => req<Page>(`/api/pages/${id}`),
  createPage: (name?: string) =>
    req<Page>("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  savePage: (id: string, updates: Partial<Pick<Page, "objects" | "grid" | "name" | "markdown" | "coloring" | "continuous">>) =>
    req<Page>(`/api/pages/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }),
  deletePage: (id: string) => req<PageIndex>(`/api/pages/${id}`, { method: "DELETE" }),
  duplicatePage: (id: string) =>
    req<Page>(`/api/pages/${id}/duplicate`, { method: "POST" }),
  activatePage: (id: string) =>
    req<PageIndex>(`/api/pages/${id}/activate`, { method: "POST" }),
  reorderPages: (ids: string[]) =>
    req<PageIndex>("/api/pages/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  // Pass `objects` to plot only that subset (a selection); omit for the whole page.
  pageGcode: (id: string, expected?: ProfileRef | null, objects?: SceneObject[]) =>
    req<Job>(`/api/pages/${id}/gcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_profile_id: expected?.id,
        expected_profile_fingerprint: expected?.fingerprint,
        objects,
      }),
    }),
  colorPageGcode: (
    id: string,
    expected: ProfileRef | null | undefined,
    colorGroupId: string,
    replaceExisting: boolean,
    colors: ColoringApiItem[],
  ) =>
    req<{ files: Job[] }>(`/api/pages/${id}/color-gcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_profile_id: expected?.id,
        expected_profile_fingerprint: expected?.fingerprint,
        color_group_id: colorGroupId,
        replace_existing: replaceExisting,
        colors,
      }),
    }),
  adoptPageProfile: (id: string, force = false, expected?: ProfileRef | null) =>
    req<Page>(`/api/pages/${id}/adopt-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        force,
        expected_profile_id: expected?.id,
        expected_profile_fingerprint: expected?.fingerprint,
      }),
    }),
  pageScore: (id: string, objects?: SceneObject[]) =>
    req<PageScore>(`/api/pages/${id}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects }),
    }),
  pagePreview3D: (id: string, objects?: SceneObject[]) =>
    req<GcodePreview3D>(`/api/pages/${id}/preview3d`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects }),
    }),
  textPolylines: (text: string, font: string, size: number, connectSpaces = false) =>
    req<{ polylines: number[][][]; feeds?: number[][]; missing?: string[] }>("/api/paint/text-polylines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, font, size, connect_spaces: connectSpaces }),
    }),
};
