export type FontKind = "builtin" | "uploaded" | "stroke";

export interface FontItem {
  id: string;
  label: string;
  builtin: boolean;
  filename?: string | null;
  mode: "plotter" | "normal";
  kind?: FontKind;
  editable?: boolean;
  glyph_count?: number | null;
}

export interface FontsResponse {
  fonts: FontItem[];
}

export interface FontUploadResponse extends FontsResponse {
  font: FontItem;
}
