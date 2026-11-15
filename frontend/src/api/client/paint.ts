import { rememberPage } from "../pageEdits";
import { req } from "./req";
import type { Page, PageIndex, PageScore, PageThumb, SceneObject, ColoringApiItem, PaintProject } from "../types/paint";
import type { Job, GcodePreview3D } from "../types/jobs";
import type { ProfileRef } from "../types/calibration";

export const paintClient = {
  listPages: (signal?: AbortSignal) => req<PageIndex>("/api/pages", { signal }),
  listProjects: () => req<PaintProject[]>("/api/projects"),
  createProject: (name: string, templateProfileId?: string, profileId?: string) => req<PageIndex>("/api/projects", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, templateProfileId, profileId }),
  }),
  activateProject: (id: string) => req<PageIndex>(`/api/projects/${id}/activate`, { method: "POST" }),
  updateProject: (id: string, updates: { name?: string; archived?: boolean; profileId?: string }) => req<PaintProject>(`/api/projects/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates),
  }),
  getPage: (id: string, signal?: AbortSignal) => req<Page>(`/api/pages/${id}`, { signal }).then(rememberPage),
  pageThumbnail: (id: string, signal?: AbortSignal) =>
    req<{ revision: number; modified: number; thumb: PageThumb | null }>(`/api/pages/${id}/thumbnail`, { signal }),
  createPage: (name?: string, folderId?: string | null) =>
    req<Page>("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folderId }),
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
  createGroup: (name: string, parentId?: string | null) =>
    req<PageIndex>("/api/pages/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    }),
  setGroupParent: (groupId: string, parentId: string | null) => req<PageIndex>(`/api/pages/groups/${groupId}/parent`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId }),
  }),
  renameGroup: (groupId: string, name: string) =>
    req<PageIndex>(`/api/pages/groups/${groupId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  deleteGroup: (groupId: string) =>
    req<PageIndex>(`/api/pages/groups/${groupId}`, { method: "DELETE" }),
  setPageGroup: (id: string, groupId: string | null) =>
    req<PageIndex>(`/api/pages/${id}/group`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    }),
  movePageToProject: (id: string, targetProjectId: string) => req<PageIndex>(`/api/pages/${id}/move`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetProjectId }),
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
  pageScore: (id: string, objects?: SceneObject[], signal?: AbortSignal) =>
    req<PageScore>(`/api/pages/${id}/score`, {
      signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects }),
    }),
  pagePreview3D: (id: string, objects?: SceneObject[], expected?: ProfileRef | null) =>
    req<GcodePreview3D>(`/api/pages/${id}/preview3d`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects, expected_profile_id: expected?.id,
        expected_profile_fingerprint: expected?.fingerprint }),
    }),
  textPolylines: (text: string, font: string, size: number, connectSpaces = false, seed = 0) =>
    req<{ polylines: number[][][]; feeds?: number[][]; missing?: string[] }>("/api/paint/text-polylines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, font, size, connect_spaces: connectSpaces, seed }),
    }),
};
