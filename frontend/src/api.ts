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

export interface AuthSession {
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface AuthSetupStart {
  setupId: string;
  totpSecret: string;
  otpauthUri: string;
}

export interface AuthSetupFinish {
  expires: number;
  recoveryCodes: string[];
}

// --- calibration profiles ---
export interface CalibrationProfileSummary {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
  created: number;
  modified: number;
  fingerprint: string;
  plot_width: number;
  plot_height: number;
  origin_x: number;
  origin_y: number;
  paper_margin: number;
  pen_calibrated: boolean;
}

export interface CalibrationProfile extends CalibrationProfileSummary {
  calibration: Calibration;
}

/** Compact reference to the profile a job/page was generated with. */
export interface ProfileRef {
  id: string | null;
  name: string | null;
  fingerprint: string | null;
}

export interface JobProfileStatus extends ProfileRef {
  matchesActive: boolean;
  stale: boolean; // same profile, but its calibration changed since
  legacy: boolean; // job has no profile metadata at all
  missing: boolean; // sidecar references a profile that no longer exists
  archived: boolean; // sidecar references an archived profile
}

export interface ProfileImportResult {
  imported: string[];
  replaced: string[];
  skipped: string[];
  profiles: CalibrationProfileSummary[];
}

export interface Job {
  filename: string;
  size: number;
  created: number;
  fits?: boolean | null; // does the job still fit the current plot area?
  issue?: string | null; // why it does not fit
  profile?: JobProfileStatus | null; // evaluated against the active profile
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
  mode: "vector" | "trace" | "edges" | "hatch" | "lines" | "dots" | "handwriting";
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

export interface SudokuResponse {
  seed: string;
  difficulty: "easy" | "medium" | "hard";
  puzzle: number[][];
  solution: number[][];
  metadata: Record<string, string | number | boolean | string[]>;
}

export interface ColoringPageResponse {
  function: "mandala" | "math_pattern";
  mode: string;
  seed: string;
  width: number;
  height: number;
  viewBox: string;
  svg: string;
  lines: number[][][];
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

/** Live plottability rating of a paint page (same scale as the gallery). */
export interface PageScore {
  score: GalleryScore | null;
  metrics: GalleryMetrics | null;
  reason: string | null;
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

export type PageProfileStatus = "active" | "other" | "stale" | "missing" | "archived";

export interface Page {
  id: string;
  name: string;
  objects: SceneObject[];
  grid: PageGrid;
  created: number;
  modified: number;
  profileId?: string | null;
  profileName?: string | null;
  profileFingerprint?: string | null;
  profileStatus?: PageProfileStatus;
}

export interface PageMeta {
  id: string;
  name: string;
  created: number;
  modified: number;
  objectCount: number;
  plottedCount: number;
  profileId?: string | null;
  profileName?: string | null;
  profileFingerprint?: string | null;
  profileStatus?: PageProfileStatus;
}

export interface PageIndex {
  order: PageMeta[];
  activeId: string | null;
  activeProfile?: ProfileRef & {
    plot_width: number;
    plot_height: number;
    origin_x: number;
    origin_y: number;
  };
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...opts });
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
  authSession: () => req<AuthSession>("/api/auth/session"),
  authSetupStart: (username: string, password: string) =>
    req<AuthSetupStart>("/api/auth/setup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  authSetupFinish: (setupId: string, code: string) =>
    req<AuthSetupFinish>("/api/auth/setup/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setupId, code }),
    }),
  authLogin: (username: string, password: string, totpCode: string, recoveryCode: string) =>
    req<{ expires: number }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, totpCode, recoveryCode }),
    }),
  authLogout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  getCalibration: () => req<Calibration>("/api/calibration"),

  // --- calibration profiles ---
  listProfiles: (includeArchived = true) =>
    req<CalibrationProfileSummary[]>(`/api/profiles?include_archived=${includeArchived}`),
  getProfile: (id: string) => req<CalibrationProfile>(`/api/profiles/${id}`),
  activeProfile: () => req<CalibrationProfile>("/api/profiles/active"),
  createProfile: (name?: string) =>
    req<CalibrationProfile>("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  saveProfile: (id: string, updates: { name?: string; calibration?: Partial<Calibration> }) =>
    req<CalibrationProfile>(`/api/profiles/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }),
  activateProfile: (id: string) =>
    req<CalibrationProfile>(`/api/profiles/${id}/activate`, { method: "POST" }),
  duplicateProfile: (id: string, name?: string) =>
    req<CalibrationProfile>(`/api/profiles/${id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  archiveProfile: (id: string, archived: boolean) =>
    req<CalibrationProfile>(`/api/profiles/${id}/${archived ? "archive" : "unarchive"}`, {
      method: "POST",
    }),
  importProfile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<CalibrationProfile>("/api/profiles/import", { method: "POST", body: fd });
  },
  importAllProfiles: (file: File, replace = false) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("replace", String(replace));
    return req<ProfileImportResult>("/api/profiles/import-all", { method: "POST", body: fd });
  },
  getMaze: (type: MazeResponse["type"], seed: number, size: string, width: number, height: number) => {
    const params = new URLSearchParams({ type, seed: String(seed), size: String(mazeSizeValue(size)), width: String(Math.round(width)), height: String(Math.round(height)) });
    return req<MazeResponse>(`/api/maze?${params.toString()}`);
  },
  getSudoku: (difficulty: SudokuResponse["difficulty"], seed: number) => {
    const params = new URLSearchParams({ difficulty, seed: String(seed) });
    return req<SudokuResponse>(`/api/sudoku?${params.toString()}`);
  },
  getColoringPage: (fn: ColoringPageResponse["function"], mode: string, seed: number, width: number, height: number, complexity: number, showSeed: boolean) => {
    const params = new URLSearchParams({ function: fn, mode, seed: String(seed), width: String(Math.round(width)), height: String(Math.round(height)), complexity: String(complexity), show_seed: String(showSeed) });
    return req<ColoringPageResponse>(`/api/coloring-pages?${params.toString()}`);
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
  pageGcode: (id: string, expected?: ProfileRef | null) =>
    req<Job>(`/api/pages/${id}/gcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_profile_id: expected?.id,
        expected_profile_fingerprint: expected?.fingerprint,
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

  createSource: (file: File, mode: "auto" | "vector" | "trace" | "edges" | "hatch" | "lines" | "dots" | "handwriting", detail: number) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    fd.append("detail", String(detail));
    return req<Source>("/api/sources", { method: "POST", body: fd });
  },
  listSources: () => req<Source[]>("/api/sources"),
  deleteSource: (id: string) =>
    req(`/api/sources/${id}`, { method: "DELETE" }),
  sourcePreview: (id: string, page: number, maxPoints?: number) =>
    req<SourcePreview>(`/api/sources/${id}/preview/${page}${maxPoints ? `?max_points=${maxPoints}` : ""}`),
  sourceThumbnail: (id: string) =>
    req<SourcePreview>(`/api/sources/${id}/thumbnail`),
  sourceThumbnails: () =>
    req<Record<string, SourcePreview>>(`/api/sources/thumbnails`),
  sourceGcode: (id: string, page: number, x: number, y: number, width: number) =>
    req<Job>(`/api/sources/${id}/gcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, x, y, width }),
    }),
  sourceScore: (id: string, page: number, x: number, y: number, width: number) =>
    req<PageScore>(`/api/sources/${id}/score`, {
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
  galleryThumbnail: (id: string) => req<GallerySvg>(`/api/gallery/${id}/thumbnail`),
  galleryThumbnails: () => req<Record<string, GallerySvg>>(`/api/gallery/thumbnails`),
  gallerySvg: (id: string) => req<GallerySvg>(`/api/gallery/${id}/svg`),
  galleryGcode3D: (id: string) =>
    req<GcodePreview3D>(`/api/gallery/${id}/gcode/preview3d`),
  gallerySetTitle: (id: string, title: string) =>
    req<GalleryItem>(`/api/gallery/${id}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
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
