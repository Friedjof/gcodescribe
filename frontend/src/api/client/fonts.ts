import { req } from "./req";
import type { FontUploadResponse, FontsResponse } from "../types/fonts";

export const fontsClient = {
  listFonts: () => req<FontsResponse>("/api/fonts"),
  uploadFont: (label: string, file: File, mode: "plotter" | "normal" = "plotter") => {
    const body = new FormData();
    body.set("label", label);
    body.set("mode", mode);
    body.set("file", file);
    return req<FontUploadResponse>("/api/fonts", { method: "POST", body });
  },
  deleteFont: (id: string) => req<FontsResponse>(`/api/fonts/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
