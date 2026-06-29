import { req } from "./req";
import type { GalleryItem, GallerySvg, GalleryPreview, GalleryUploader, StlLayerPayload } from "../types/gallery";
import type { GcodePreview3D } from "../types/jobs";

export const galleryClient = {
  galleryUploadInfo: () => req<{ enabled: boolean; secret_required: boolean }>("/api/gallery/upload-info"),
  galleryUploadConfig: () => req<{ enabled: boolean; secret: string }>("/api/gallery/upload-config"),
  galleryUpload: (file: File, title: string, opts?: { mode?: string; detail?: number; secret?: string }) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title);
    if (opts?.mode) fd.append("mode", opts.mode);
    if (opts?.detail != null) fd.append("detail", String(opts.detail));
    if (opts?.secret) fd.append("secret", opts.secret);
    return req<GalleryItem>("/api/gallery", { method: "POST", body: fd });
  },
  galleryList: (includeArchived = true, uploader?: GalleryUploader) =>
    req<GalleryItem[]>(
      `/api/gallery?include_archived=${includeArchived}` +
        (uploader ? `&uploader=${uploader}` : "")
    ),
  galleryThumbnail: (id: string) => req<GallerySvg>(`/api/gallery/${id}/thumbnail`),
  galleryThumbnails: () => req<Record<string, GallerySvg>>(`/api/gallery/thumbnails`),
  gallerySvg: (id: string) => req<GallerySvg>(`/api/gallery/${id}/svg`),
  galleryPreview: (id: string, page: number) =>
    req<GalleryPreview>(`/api/gallery/${id}/preview/${page}`),
  galleryOriginalUrl: (id: string) => `/api/gallery/${id}/original`,
  galleryCreateStl: (
    stl: BlobPart, filename: string, params: object, layers: StlLayerPayload[], title = "",
  ) => {
    const fd = new FormData();
    fd.append("file", new Blob([stl], { type: "model/stl" }), filename);
    fd.append("params", JSON.stringify(params));
    fd.append("layers", JSON.stringify(layers));
    fd.append("title", title);
    return req<GalleryItem>("/api/gallery/stl", { method: "POST", body: fd });
  },
  galleryStlParams: (id: string) =>
    req<Record<string, unknown>>(`/api/gallery/${id}/stl-params`),
  galleryUpdateStl: (id: string, params: object, layers: StlLayerPayload[]) => {
    const fd = new FormData();
    fd.append("params", JSON.stringify(params));
    fd.append("layers", JSON.stringify(layers));
    return req<GalleryItem>(`/api/gallery/${id}/stl`, { method: "POST", body: fd });
  },
  galleryGcode3D: (id: string) =>
    req<GcodePreview3D>(`/api/gallery/${id}/gcode/preview3d`),
  gallerySetTitle: (id: string, title: string) =>
    req<GalleryItem>(`/api/gallery/${id}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  galleryRender: (id: string, mode: string, detail: number, continuous = false) =>
    req<GalleryItem>(`/api/gallery/${id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, detail, continuous }),
    }),
  galleryArchive: (id: string, archived: boolean) =>
    req<GalleryItem>(`/api/gallery/${id}/${archived ? "archive" : "unarchive"}`, {
      method: "POST",
    }),
  galleryDelete: (id: string) => req(`/api/gallery/${id}`, { method: "DELETE" }),
};
