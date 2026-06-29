import { req } from "./req";
import type { AiImageStatus, AiImageResult } from "../types/ai";

export const aiClient = {
  aiImageStatus: () => req<AiImageStatus>("/api/ai-images/status"),
  aiImageGenerate: (
    file: File | null,
    opts?: {
      instructions?: string;
      feedback?: string;
      baseVariantId?: string;
      title?: string;
      renderMode?: string;
      detail?: number;
      effect?: string;
      textStyle?: string;
      detailLevel?: number;
      aspectRatio?: string;
    }
  ) => {
    const fd = new FormData();
    // No file on a feedback request: the backend iterates on the parent variant.
    if (file) fd.append("file", file);
    if (opts?.instructions) fd.append("instructions", opts.instructions);
    if (opts?.feedback) fd.append("feedback", opts.feedback);
    if (opts?.baseVariantId) fd.append("base_variant_id", opts.baseVariantId);
    if (opts?.title) fd.append("title", opts.title);
    if (opts?.renderMode) fd.append("render_mode", opts.renderMode);
    if (opts?.detail != null) fd.append("detail", String(opts.detail));
    if (opts?.effect) fd.append("effect", opts.effect);
    if (opts?.textStyle) fd.append("text_style", opts.textStyle);
    if (opts?.detailLevel != null) fd.append("detail_level", String(opts.detailLevel));
    if (opts?.aspectRatio) fd.append("aspect_ratio", opts.aspectRatio);
    return req<AiImageResult>("/api/ai-images/generate", { method: "POST", body: fd });
  },
  aiImageRerender: (itemId: string, renderMode: string, detail: number) =>
    req<AiImageResult>(`/api/ai-images/${itemId}/rerender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ render_mode: renderMode, detail }),
    }),
  aiImageSave: (itemId: string) =>
    req<AiImageResult>(`/api/ai-images/${itemId}/save`, { method: "POST" }),
};
