import { useSyncExternalStore } from "react";
import { req } from "./client/req";
import { onAppEvent } from "./events";

export type ImportTarget = { page_id: string; project_id?: string | null; profile_id?: string | null; fingerprint?: string | null; x: number; y: number; width: number; height: number; page_name?: string };
export type AssetTask = {
  id: string; kind: "import" | "render"; filename: string; state: string; phase: string;
  created: number; updated: number; target?: ImportTarget; item_id?: string; item_ids?: string[]; attached?: boolean;
  error?: string;
  dismissed?: boolean;
  local?: boolean;
};
let snapshot: AssetTask[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
function receive(task: AssetTask, announce = true) {
  if (task.dismissed) { snapshot = snapshot.filter((t) => t.id !== task.id); emit(); return; }
  const previous = snapshot.find((t) => t.id === task.id);
  if (previous && !previous.local && previous.updated > task.updated) return;
  snapshot = [task, ...snapshot.filter((t) => t.id !== task.id)].sort((a, b) => b.created - a.created);
  emit();
  if (announce && task.state === "done" && previous?.state !== "done") {
    window.dispatchEvent(new CustomEvent("gcs:asset-ready", { detail: task }));
  }
}
export function useAssetTasks() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => snapshot);
}
export function watchAssetTasks(onError: (error: unknown) => void) {
  let active = true;
  let loading = false;
  let offline = false;
  let hydrated = false;
  const refresh = async () => {
    if (loading || document.hidden) return;
    loading = true;
    try {
      const tasks = await req<AssetTask[]>("/api/asset-tasks");
      if (active) {
        for (const task of tasks) receive(task, hydrated || snapshot.some((old) => old.id === task.id));
        hydrated = true; offline = false; onError(null);
      }
    } catch (error) { if (active) { offline = true; onError(error); } }
    finally { loading = false; }
  };
  void refresh();
  const stop = onAppEvent((event) => {
    if (event.type === "asset-task") receive(event.task);
    if (event.type === "hello") void refresh();
  });
  const timer = window.setInterval(() => { if (offline || snapshot.some((task) => ["queued", "running"].includes(task.state))) void refresh(); }, 5000);
  document.addEventListener("visibilitychange", refresh);
  return () => { active = false; stop(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
}
export type XoppPagePreview = { n: number; strokes: number; preview: { polylines: number[][][]; width: number; height: number } };
export async function previewXopp(file: File): Promise<XoppPagePreview[]> {
  const body = new FormData();
  body.append("file", file);
  const response = await req<{ pages: XoppPagePreview[] }>("/api/asset-tasks/xopp-preview", { method: "POST", body });
  return response.pages;
}

export async function startImport(file: File, options: { mode?: string; detail?: number; title?: string; target?: ImportTarget; selectedPages?: number[] } = {}) {
  const id = crypto.randomUUID().replace(/-/g, "");
  const upload: AssetTask = { id, kind: "import", filename: file.name, state: "uploading", phase: "uploading", created: Date.now() / 1000, updated: Date.now() / 1000, target: options.target, local: true };
  receive(upload);
  const body = new FormData();
  body.append("client_id", id);
  body.append("file", file); body.append("mode", options.mode ?? "auto");
  body.append("detail", String(options.detail ?? 2)); body.append("title", options.title ?? "");
  if (options.selectedPages) body.append("selected_pages", JSON.stringify(options.selectedPages));
  if (options.target) body.append("target", JSON.stringify(options.target));
  try {
    const task = await req<AssetTask>("/api/asset-tasks/import", { method: "POST", body });
    // Server and client clocks need not be synchronized.
    if (snapshot.find((t) => t.id === id)?.local) snapshot = snapshot.filter((t) => t.id !== id);
    receive(task); return task;
  } catch (error) {
    const known = snapshot.find((t) => t.id === id);
    if (known && !known.local) return known;
    receive({ ...upload, state: "failed", phase: "failed", updated: Date.now() / 1000, error: String((error as Error).message ?? error) });
    throw error;
  }
}
export async function startRender(id: string, mode: string, detail: number, continuous: boolean) {
  const task = await req<AssetTask>(`/api/asset-tasks/render/${id}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, detail, continuous }),
  });
  receive(task); return task;
}
export async function taskAction(id: string, action: "cancel" | "retry" | "dismiss") {
  if (action === "dismiss") {
    if (!snapshot.find((t) => t.id === id)?.local) await req(`/api/asset-tasks/${id}`, { method: "DELETE" });
    snapshot = snapshot.filter((t) => t.id !== id); emit();
  } else receive(await req<AssetTask>(`/api/asset-tasks/${id}/${action}`, { method: "POST" }));
}
