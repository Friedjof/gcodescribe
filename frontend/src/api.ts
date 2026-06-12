export interface Calibration {
  bed_width: number;
  bed_height: number;
  plot_width: number;
  plot_height: number;
  origin_x: number;
  origin_y: number;
  pen_up_z: number;
  pen_down_z: number;
  pen_calibrated: boolean;
  travel_feed: number;
  draw_feed: number;
  z_feed: number;
  fit_to_area: boolean;
  flip_y: boolean;
  paper_corners: Record<string, [number, number]>;
  paper_margin: number;
}

export interface Job {
  filename: string;
  size: number;
  created: number;
  fits?: boolean | null; // does the job still fit the current plot area?
  issue?: string | null; // why it does not fit
}

export interface Position {
  x: number;
  y: number;
  z: number;
  homed: boolean;
  homed_axes: string[];
}

export interface PaperState {
  calibration: Calibration;
  rect: [number, number, number, number] | null;
}

export interface GcodePreview {
  polylines: number[][][];
  travels: number[][][];
  bounds: [number, number, number, number] | null;
  truncated: boolean;
}

export interface GcodePreview3D {
  draws: number[][][]; // polylines of [x, y, z] mm where the pen draws
  travels: number[][][]; // pen-up moves incl. Z lifts
  bounds: [number, number, number, number, number, number] | null; // x,y,z min/max
  truncated: boolean;
}

export interface SourcePage {
  n: number;
  file: string;
  width: number;
  height: number;
  lines: number;
}

export interface Source {
  id: string;
  name: string;
  mode: "vector" | "trace" | "edges" | "hatch" | "lines" | "dots";
  detail: number;
  created: number;
  pages: SourcePage[];
}

export interface SourcePreview {
  polylines: number[][][];
  bounds: [number, number, number, number] | null;
  width: number;
  height: number;
}

export interface MazeResponse {
  type: "classic" | "masked" | "hex" | "polar";
  seed: string;
  size: number;
  width: number;
  height: number;
  viewBox: string;
  maze_svg: string;
  solution_svg: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  wall_lines: number[][][];
  marker_lines: number[][][];
  solution_lines: number[][][];
  metadata: Record<string, string | number | boolean>;
}

// --- gallery (event submissions) ---
export interface GalleryScore {
  total: number;
  time: number;
  lifts: number;
  size: number;
  detail: number;
}

export interface GalleryMetrics {
  size_bytes: number;
  command_count: number;
  pen_lifts: number;
  polyline_count: number;
  point_count: number;
  draw_mm: number;
  travel_mm: number;
  duration_s: number;
  points_per_mm: number;
}

export interface GalleryItem {
  id: string;
  title: string;
  filename: string;
  kind: "svg" | "png" | "jpeg";
  created: number;
  status: "active" | "archived";
  width: number;
  height: number;
  lines: number;
  metrics: GalleryMetrics;
  score: GalleryScore;
}

export interface GallerySvg {
  polylines: number[][][];
  width: number;
  height: number;
}

// --- paint document (multi-page) ---
export interface PageGrid {
  step: number;
  snap: boolean;
}

// A scene object. Phase 1 stores them opaquely; later phases fill in data.
export interface SceneObject {
  id: string;
  type: "image" | "text" | "freehand" | "pen" | "line" | "rect" | "circle" | "semicircle" | string;
  transform?: { x: number; y: number; rotation: number; scale: number; scaleX?: number; scaleY?: number };
  zOrder?: number;
  groupId?: string;
  data?: any;
  cachedPolylines?: number[][][];
  plotted?: boolean;
}

export interface Page {
  id: string;
  name: string;
  objects: SceneObject[];
  grid: PageGrid;
  created: number;
  modified: number;
}

export interface PageMeta {
  id: string;
  name: string;
  created: number;
  modified: number;
  objectCount: number;
  plottedCount: number;
}

export interface PageIndex {
  order: PageMeta[];
  activeId: string | null;
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

function mazeSizeValue(size: string) {
  if (size === "small") return 14;
  if (size === "large") return 26;
  if (size === "huge") return 33;
  if (size === "extreme") return 40;
  return 20;
}

export const api = {
  getCalibration: () => req<Calibration>("/api/calibration"),
  getMaze: (type: MazeResponse["type"], seed: number, size: string, width: number, height: number) => {
    const params = new URLSearchParams({ type, seed: String(seed), size: String(mazeSizeValue(size)), width: String(Math.round(width)), height: String(Math.round(height)) });
    return req<MazeResponse>(`/api/maze?${params.toString()}`);
  },
  saveCalibration: (c: Partial<Calibration>) =>
    req<Calibration>("/api/calibration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    }),
  importCalibration: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<Calibration>("/api/calibration/import", { method: "POST", body: fd });
  },

  // --- paint document ---
  listPages: () => req<PageIndex>("/api/pages"),
  getPage: (id: string) => req<Page>(`/api/pages/${id}`),
  createPage: (name?: string) =>
    req<Page>("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  savePage: (id: string, updates: Partial<Pick<Page, "objects" | "grid" | "name">>) =>
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
  pageGcode: (id: string) =>
    req<Job>(`/api/pages/${id}/gcode`, { method: "POST" }),

  listJobs: () => req<Job[]>("/api/jobs"),
  deleteJob: (name: string) =>
    req(`/api/jobs/${encodeURIComponent(name)}`, { method: "DELETE" }),
  renameJob: (name: string, newName: string) =>
    req<Job>(`/api/jobs/${encodeURIComponent(name)}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    }),
  convert: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ files: Job[] }>("/api/convert", { method: "POST", body: fd });
  },
  testPattern: (name: string) =>
    req<Job>(`/api/testpattern/${name}`, { method: "POST" }),

  octoStatus: () => req<any>("/api/octoprint/status"),
  send: (filename: string, start: boolean) =>
    req<any>("/api/octoprint/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, start }),
    }),
  jobCommand: (command: string) =>
    req("/api/octoprint/job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    }),
  jog: (
    x: number,
    y: number,
    z: number,
    opts?: { speed?: number; limit?: "bed" | "plot" }
  ) =>
    req("/api/octoprint/jog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, z, speed: opts?.speed, limit: opts?.limit ?? "bed" }),
    }),
  home: (axes?: string[]) =>
    req("/api/octoprint/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ axes }),
    }),
  pen: (down: boolean) =>
    req("/api/octoprint/pen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ down }),
    }),

  penFromPosition: (which: "up" | "down") =>
    req<Calibration>("/api/calibration/pen-from-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ which }),
    }),

  position: () => req<Position>("/api/position"),
  move: (x: number, y: number) =>
    req<{ ok: boolean; position: Position }>("/api/octoprint/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    }),

  moveToCorner: (corner: string, target: "paper" | "plot" = "paper") =>
    req<{ ok: boolean; position: Position }>("/api/octoprint/move-to-corner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corner, target }),
    }),

  paper: () => req<PaperState>("/api/paper"),
  setCorner: (corner: string) =>
    req<PaperState>("/api/paper/corner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corner }),
    }),
  clearCorner: (corner: string) =>
    req<PaperState>(`/api/paper/corner/${corner}`, { method: "DELETE" }),
  resetPaper: () => req<PaperState>("/api/paper", { method: "DELETE" }),
  applyPaper: (margin: number) =>
    req<PaperState>("/api/paper/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ margin }),
    }),
  jobPreview: (filename: string) =>
    req<GcodePreview>(`/api/jobs/${encodeURIComponent(filename)}/preview`),
  jobPreview3D: (filename: string) =>
    req<GcodePreview3D>(`/api/jobs/${encodeURIComponent(filename)}/preview3d`),

  createSource: (file: File, mode: "auto" | "vector" | "trace" | "edges" | "hatch" | "lines" | "dots", detail: number) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    fd.append("detail", String(detail));
    return req<Source>("/api/sources", { method: "POST", body: fd });
  },
  listSources: () => req<Source[]>("/api/sources"),
  deleteSource: (id: string) =>
    req(`/api/sources/${id}`, { method: "DELETE" }),
  sourcePreview: (id: string, page: number) =>
    req<SourcePreview>(`/api/sources/${id}/preview/${page}`),
  sourceGcode: (id: string, page: number, x: number, y: number, width: number) =>
    req<Job>(`/api/sources/${id}/gcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, x, y, width }),
    }),
  galleryUpload: (file: File, title: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title);
    return req<GalleryItem>("/api/gallery", { method: "POST", body: fd });
  },
  galleryList: (includeArchived = true) =>
    req<GalleryItem[]>(`/api/gallery?include_archived=${includeArchived}`),
  gallerySvg: (id: string) => req<GallerySvg>(`/api/gallery/${id}/svg`),
  galleryGcode3D: (id: string) =>
    req<GcodePreview3D>(`/api/gallery/${id}/gcode/preview3d`),
  galleryArchive: (id: string, archived: boolean) =>
    req<GalleryItem>(`/api/gallery/${id}/${archived ? "archive" : "unarchive"}`, {
      method: "POST",
    }),
  galleryDelete: (id: string) => req(`/api/gallery/${id}`, { method: "DELETE" }),

  textPolylines: (text: string, font: string, size: number) =>
    req<{ polylines: number[][][] }>("/api/paint/text-polylines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, font, size }),
    }),
};
