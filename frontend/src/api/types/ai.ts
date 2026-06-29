import type { GalleryItem, GalleryPreview } from "./gallery";

/** Feature-gating + capabilities. Disabled responses carry only `enabled`. */
export interface AiImageStatus {
  enabled: boolean;
  model?: string;
  apiMode?: string;
  maxInputMb?: number;
  size?: string;
  supportsFeedback?: boolean;
  supportsStreaming?: boolean;
  stylePrompts?: Record<string, string>;
  effectPrompts?: Record<string, string>;
  textPrompts?: Record<string, string>;
  aspectPrompts?: Record<string, string>;
}

export interface AiImageQuality {
  lineCount: number;
  pointCount: number;
  shortLineCount: number;
  shortLineRatio: number;
  medianLineLength: number;
  boundsFillRatio: number | null;
  complexity: "good" | "medium" | "bad";
  warnings: string[];
  feedbackSuggestions: string[];
}

/** One generated variant: the persisted gallery item plus its traced preview,
 * the source image URL, the prompt used and a plottability assessment. */
export interface AiImageResult {
  variantId: string;
  parentVariantId: string | null;
  saved: boolean;
  galleryItem: GalleryItem;
  preview: GalleryPreview;
  imageUrl: string;
  prompt: { style: string; instructions: string; feedback: string; text: string };
  quality: AiImageQuality;
}
