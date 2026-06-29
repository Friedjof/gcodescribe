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
