import { useEffect, useRef, useState } from "react";
import { api, type AiImageResult, type AiImageStatus } from "../api";
import { useI18n } from "../i18n";
import { galleryPageObject } from "../paint/insertAsset";
import Modal from "./Modal";
import PolylinePreview from "./PolylinePreview";
import Segmented from "./Segmented";
import { useToasts } from "./Toasts";

type RenderMode = "edges" | "handwriting" | "trace";
type AspectRatio = "auto" | "1:1" | "3:4" | "4:3" | "16:9" | "9:16";

// Option keys — labels come from i18n, prompt fragments from the status maps.
const EFFECTS = ["none", "realistic", "artistic", "comic", "caricature", "childlike", "minimalist"];
const TEXT_STYLES = ["none", "handwriting", "cursive", "messy", "child", "serif", "sans"];
const ASPECT_RATIOS: AspectRatio[] = ["auto", "1:1", "3:4", "4:3", "16:9", "9:16"];

const aspectRatioLabel = (value: AspectRatio) => (value === "auto" ? "✦" : value);

const PLOTTER_STYLE_LOCK =
  "Final non-negotiable plotter-style lock: the output must be a newly redrawn " +
  "plotter-ready black-and-white artwork, not a copy, filter, colorized version, " +
  "or lightly modified version of the input image. Ignore any visual temptation " +
  "to preserve original colors, lighting, gradients, shadows, photographic " +
  "texture, skin tones, material colors, background scenery, or raster detail. " +
  "Use only pure black (#000000) marks on a pure white (#FFFFFF) background. " +
  "No color, no gray, no semi-transparent pixels, no gradients, no shading, no " +
  "photo texture, no blur, no anti-aliased soft edges, no realistic lighting, " +
  "no filled colored areas. The image must be easy to vectorize into clean SVG " +
  "paths for a single pen plotter: clear contours, intentional lines, simple " +
  "negative space, and strong obedience to every plotter constraint above. If " +
  "any user instruction conflicts with these plotter constraints, follow the " +
  "plotter constraints.";

const composePromptPreview = (
  status: AiImageStatus | null,
  renderMode: RenderMode,
  detailLevel: number,
  effect: string,
  textStyle: string,
  aspectRatio: AspectRatio,
  instructions: string,
  feedback = ""
) => {
  const base = status?.stylePrompts?.[renderMode];
  if (!base) return null;
  const parts = [
    base,
    `Level of detail: ${detailLevel} out of 10 — on this scale 1 means extremely ` +
      "minimal, just a few essential outlines with lots of empty space, and 10 " +
      "means very detailed with many fine interior lines and rich texture. " +
      `Match a detail level of ${detailLevel}. This detail level describes ONLY the ` +
      "amount of black plotter strokes, contours, interior linework, and path " +
      "complexity. It does NOT mean preserving the original photo as a colored " +
      "or shaded image. Even at high detail, the result must remain pure black " +
      "line art on a pure white background.",
  ];
  const eff = status?.effectPrompts?.[effect];
  if (effect !== "none" && eff) parts.push(eff);
  const txt = status?.textPrompts?.[textStyle];
  if (textStyle !== "none" && txt) parts.push(txt);
  const aspect = status?.aspectPrompts?.[aspectRatio];
  if (aspectRatio !== "auto" && aspect) parts.push(aspect);
  const extra = instructions.trim();
  if (extra) parts.push(`User instructions: ${extra}`);
  const refinement = feedback.trim();
  if (refinement) {
    parts.push(
      "If feedback is provided, improve the previous result according to it " +
        "while keeping the plotter-ready line style.\n" +
        `Feedback: ${refinement}`
    );
  }
  parts.push(PLOTTER_STYLE_LOCK);
  return parts.join("\n\n");
};

/** The AI Designer tab: upload a reference image, generate a plotter-ready
 * line drawing (persisted as a gallery asset), then refine it with feedback
 * into further variants. Each variant can be opened straight in the designer. */
export default function AiImageDesigner({
  status,
  visible = true,
  onOpenPaint,
  initialFile = null,
}: {
  status: AiImageStatus | null;
  visible?: boolean;
  onOpenPaint: () => void;
  initialFile?: File | null;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [renderMode, setRenderMode] = useState<RenderMode>("edges");
  const [detailLevel, setDetailLevel] = useState(5);
  const [effect, setEffect] = useState("none");
  const [textStyle, setTextStyle] = useState("none");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [variants, setVariants] = useState<AiImageResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Local object-URL preview of the upload; revoked on change to avoid leaks.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Pre-populate with an image passed in from outside (e.g. from the gallery).
  useEffect(() => {
    if (initialFile) pick(initialFile);
  }, [initialFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxMb = status?.maxInputMb ?? 10;
  const selected = variants.find((v) => v.variantId === selectedId) ?? null;
  const canGenerateInitial = Boolean(file || instructions.trim());

  const pick = (f: File | null | undefined) => {
    setErr(null);
    if (!f) return;
    if (!/\.(png|jpe?g)$/i.test(f.name)) {
      setErr(t("ai.errType"));
      return;
    }
    if (f.size > maxMb * 1024 * 1024) {
      setErr(t("ai.errSize", { mb: maxMb }));
      return;
    }
    if (variants.length > 0) {
      setPendingFile(f);
      setShowDiscardDialog(true);
      return;
    }
    setFile(f);
  };

  const handleReset = () => {
    if (variants.length > 0) {
      setPendingFile(null);
      setShowDiscardDialog(true);
    }
  };

  const doReset = (nextFile: File | null) => {
    setVariants([]);
    setSelectedId(null);
    setFeedback("");
    setFile(nextFile);
    setPendingFile(null);
    setShowDiscardDialog(false);
  };

  const handleDiscardConfirm = () => doReset(pendingFile);

  const handleSaveAndDiscard = () => {
    if (!selected || selected.saved) {
      doReset(pendingFile);
      return;
    }
    setSaving(true);
    api
      .aiImageSave(selected.galleryItem.id)
      .then((updated) => {
        setVariants((prev) =>
          prev.map((v) => (v.variantId === updated.variantId ? updated : v))
        );
        doReset(pendingFile);
      })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setSaving(false));
  };

  // baseVariantId set → a feedback refinement (no re-upload); else first pass.
  const generate = (baseVariantId?: string) => {
    if (busy) return;
    if (!baseVariantId && !canGenerateInitial) return;
    if (baseVariantId && !feedback.trim()) return;
    setBusy(true);
    setErr(null);
    api
      .aiImageGenerate(baseVariantId ? null : file, {
        instructions,
        feedback: baseVariantId ? feedback : "",
        baseVariantId,
        renderMode,
        effect,
        textStyle,
        detailLevel,
        aspectRatio,
      })
      .then((result) => {
        setVariants((prev) => [...prev, result]);
        setSelectedId(result.variantId);
        if (baseVariantId) setFeedback("");
      })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };

  const toDesigner = () => {
    if (!selected || importing) return;
    setImporting(true);
    setErr(null);
    const { galleryItem, preview } = selected;
    api
      .getCalibration()
      .then((cal) =>
        api
          .createPage(galleryItem.title)
          .then((page) =>
            api.savePage(page.id, {
              objects: [galleryPageObject(galleryItem, preview, 1, cal)],
            })
          )
      )
      .then(() => onOpenPaint())
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setImporting(false));
  };

  // Re-trace the selected variant in another mode/detail without a new
  // generation (no provider call); replace it in place with the fresh result.
  const recompute = (mode: RenderMode, lvl: number) => {
    if (!selected || rerendering) return;
    setRerendering(true);
    setErr(null);
    api
      .aiImageRerender(selected.galleryItem.id, mode, lvl)
      .then((updated) =>
        setVariants((prev) =>
          prev.map((v) => (v.variantId === updated.variantId ? updated : v))
        )
      )
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setRerendering(false));
  };

  // AI results are drafts (hidden from the gallery) until explicitly saved.
  const saveToGallery = () => {
    if (!selected || saving || selected.saved) return;
    setSaving(true);
    setErr(null);
    api
      .aiImageSave(selected.galleryItem.id)
      .then((updated) =>
        setVariants((prev) =>
          prev.map((v) => (v.variantId === updated.variantId ? updated : v))
        )
      )
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setSaving(false));
  };

  const addSuggestion = (s: string) =>
    setFeedback((f) => (f.trim() ? `${f.trim()} ${s}` : s));

  const quality = selected?.quality;
  const suggestions = quality?.feedbackSuggestions ?? [];

  // Live preview of the prompt that will be sent with the current parameters.
  const promptPreview = composePromptPreview(
    status,
    renderMode,
    detailLevel,
    effect,
    textStyle,
    aspectRatio,
    instructions
  );
  const refinementPromptPreview = composePromptPreview(
    status,
    renderMode,
    detailLevel,
    effect,
    textStyle,
    aspectRatio,
    instructions,
    feedback
  );

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

  return (
    <section className={`ai-designer ${visible ? "" : "hidden"}`.trim()}>
      {/* Left: controls column, mirroring the designer's tools card. */}
      <aside className="card ai-controls">
        <h2>{t("ai.title")}</h2>
        <p className="muted small">{t("ai.subtitle")}</p>

        <div
          className={`ai-dropzone ${dragging ? "drag" : ""} ${previewUrl ? "has-image" : ""}`.trim()}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt={file?.name ?? ""} />
          ) : (
            <div className="ai-dropzone-empty">
              <span className="ai-dropzone-icon">⬆</span>
              <span>{t("ai.uploadHint")}</span>
              <span className="muted small">{t("ai.uploadTypes", { mb: maxMb })}</span>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
        {file && (
          <button className="link-btn" onClick={() => setFile(null)}>
            {t("ai.changeImage")}
          </button>
        )}

        <label className="ai-field">
          <span className="ai-field-head">
            {t("ai.instructionsLabel")}
            <button type="button" className="link-btn" onClick={() => setEditingInstructions(true)}>
              {t("ai.editInstructions")}
            </button>
          </span>
          <textarea
            rows={3}
            value={instructions}
            maxLength={2000}
            placeholder={t("ai.instructionsPlaceholder")}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>

        <label className="ai-field">
          {t("ai.renderMode")}
          <Segmented<RenderMode>
            className="nav"
            value={renderMode}
            onChange={setRenderMode}
            options={[
              { value: "edges", label: t("ai.mode.edges") },
              { value: "handwriting", label: t("ai.mode.handwriting") },
              { value: "trace", label: t("ai.mode.trace") },
            ]}
          />
        </label>

        <label className="ai-field ai-detail">
          <span className="ai-detail-head">
            {t("ai.detail")}
            <span className="ai-detail-value">{detailLevel}/10</span>
          </span>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={detailLevel}
            onChange={(e) => setDetailLevel(Number(e.target.value))}
          />
          <span className="ai-detail-scale muted small">{t("ai.detailScale")}</span>
        </label>

        <label className="ai-field">
          {t("ai.aspectRatio")}
          <Segmented<AspectRatio>
            className="nav ai-aspect-segmented"
            value={aspectRatio}
            onChange={setAspectRatio}
            options={ASPECT_RATIOS.map((k) => ({
              value: k,
              label: aspectRatioLabel(k),
              title: t(`ai.aspect.${k}`),
            }))}
          />
        </label>

        <div className="ai-option-row">
          <label className="ai-field">
            {t("ai.effectLabel")}
            <select value={effect} onChange={(e) => setEffect(e.target.value)}>
              {EFFECTS.map((k) => (
                <option key={k} value={k}>
                  {t(`ai.effect.${k}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="ai-field">
            {t("ai.textLabel")}
            <select value={textStyle} onChange={(e) => setTextStyle(e.target.value)}>
              {TEXT_STYLES.map((k) => (
                <option key={k} value={k}>
                  {t(`ai.text.${k}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {promptPreview && (
          <div className="ai-style">
            <strong>{t("ai.styleTitle")}</strong>
            <p className="muted small">{t("ai.styleHint")}</p>
            <details className="ai-prompt-view">
              <summary>{t("ai.showStylePrompt")}</summary>
              <pre>{promptPreview}</pre>
            </details>
          </div>
        )}

        <button className="primary" disabled={!canGenerateInitial || busy} onClick={() => generate()}>
          {busy && !selected ? t("ai.generating") : t("ai.generate")}
        </button>
        <p className="muted small ai-cost">{t("ai.costHint")}</p>
      </aside>

      {editingInstructions && (
        <Modal
          title={t("ai.instructionsModalTitle")}
          className="ai-prompt-modal"
          bodyClassName="ai-prompt-modal-body"
          onClose={() => setEditingInstructions(false)}
          footer={
            <>
              <button onClick={() => setEditingInstructions(false)}>{t("common.cancel")}</button>
              <button className="primary" onClick={() => setEditingInstructions(false)}>
                {t("common.apply")}
              </button>
            </>
          }
        >
          <label className="ai-field ai-prompt-editor">
            <span>{t("ai.instructionsModalHint")}</span>
            <textarea
              autoFocus
              rows={14}
              value={instructions}
              maxLength={2000}
              placeholder={t("ai.instructionsPlaceholder")}
              onChange={(e) => setInstructions(e.target.value)}
            />
            <span className="muted small">{instructions.length}/2000</span>
          </label>
        </Modal>
      )}

      {showDiscardDialog && (
        <Modal
          title={t("ai.discardDialogTitle")}
          className="ai-discard-modal"
          onClose={() => {
            setPendingFile(null);
            setShowDiscardDialog(false);
          }}
          footer={
            <>
              <button
                onClick={() => {
                  setPendingFile(null);
                  setShowDiscardDialog(false);
                }}
              >
                {t("common.cancel")}
              </button>
              <button onClick={handleDiscardConfirm}>{t("ai.discardDiscard")}</button>
              {selected && !selected.saved && (
                <button className="primary" disabled={saving} onClick={handleSaveAndDiscard}>
                  {saving ? t("common.loading") : t("ai.discardSave")}
                </button>
              )}
            </>
          }
        >
          <p>{t("ai.discardDialogBody")}</p>
        </Modal>
      )}

      {/* Right: editor card — toolbar header, stage, and a tools side panel. */}
      <section className="card ai-editor">
        <div className="ai-editor-toolbar">
          <h2>{t("ai.resultTitle")}</h2>
          <div className="ai-editor-actions">
            {variants.length > 1 && (
              <div className="ai-variant-strip">
                {variants.map((v, i) => (
                  <button
                    key={v.variantId}
                    className={`ai-variant-chip ${v.variantId === selectedId ? "active" : ""}`.trim()}
                    onClick={() => setSelectedId(v.variantId)}
                  >
                    {`V${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            {variants.length > 0 && (
              <button onClick={handleReset}>{t("ai.resetBtn")}</button>
            )}
            {selected && !selected.saved && (
              <button disabled={saving} onClick={saveToGallery}>
                {saving ? t("common.loading") : t("ai.saveToGallery")}
              </button>
            )}
            {selected && (
              <button className="primary" disabled={importing} onClick={toDesigner}>
                {importing ? t("common.loading") : t("ai.openDesigner")}
              </button>
            )}
          </div>
        </div>

        <div className={`ai-editor-body ${selected ? "" : "no-side"}`.trim()}>
          {/* Stage: the plotter line preview is the hero, with reference thumbs. */}
          <div className="ai-stage">
            {busy && (
              <div className="ai-result-busy">
                <span className="spinner" />
                <h3>{t("ai.generatingTitle")}</h3>
                <p className="muted small">{t("ai.generatingHint")}</p>
              </div>
            )}
            {variants.length === 0 ? (
              <div className="paint-empty-hint">
                <span className="ai-empty-icon">✎</span>
                <h3>{t("ai.emptyTitle")}</h3>
                <p className="muted">{t("ai.emptyHint")}</p>
              </div>
            ) : selected ? (
              <>
                <div className="ai-stage-main">
                  <PolylinePreview data={selected.preview} className="ai-poly" />
                </div>
                <div className="ai-stage-thumbs">
                  <figure>
                    <figcaption className="muted small">{t("ai.resultSource")}</figcaption>
                    {previewUrl ? <img src={previewUrl} alt="" /> : <div className="ai-ph" />}
                  </figure>
                  <figure>
                    <figcaption className="muted small">{t("ai.resultOutput")}</figcaption>
                    <img src={selected.imageUrl} alt="" />
                  </figure>
                </div>
              </>
            ) : null}
          </div>

          {/* Side panel: quality, re-trace, feedback and prompt. */}
          {selected && (
            <aside className="ai-side">
              <div className={`ai-quality ${quality?.complexity}`}>
                <span className="ai-badge">{t(`ai.quality.${quality?.complexity}`)}</span>
                <span className="muted small">
                  {t("ai.qualityStats", {
                    lines: quality?.lineCount ?? 0,
                    points: quality?.pointCount ?? 0,
                    short: quality?.shortLineCount ?? 0,
                  })}
                </span>
              </div>
              {quality?.warnings.map((w) => (
                <div key={w} className="banner warn">
                  {w}
                </div>
              ))}

              <div className="ai-field ai-recompute">
                <span>
                  {t("ai.recompute")}
                  {rerendering && <span className="muted small"> · {t("ai.generating")}</span>}
                </span>
                <Segmented<RenderMode>
                  className="nav"
                  value={(selected.galleryItem.mode as RenderMode) ?? "edges"}
                  onChange={(m) => recompute(m, selected.galleryItem.detail ?? 2)}
                  options={[
                    { value: "edges", label: t("ai.mode.edges") },
                    { value: "handwriting", label: t("ai.mode.handwriting") },
                    { value: "trace", label: t("ai.mode.trace") },
                  ]}
                />
                <Segmented<number>
                  className="nav"
                  value={selected.galleryItem.detail ?? 2}
                  onChange={(d) => recompute((selected.galleryItem.mode as RenderMode) ?? "edges", d)}
                  options={[
                    { value: 1, label: "1" },
                    { value: 2, label: "2" },
                    { value: 3, label: "3" },
                  ]}
                />
              </div>

              <div className="ai-feedback">
                <label className="ai-field">
                  {t("ai.feedbackLabel")}
                  <textarea
                    rows={2}
                    value={feedback}
                    maxLength={1000}
                    placeholder={t("ai.feedbackPlaceholder")}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                </label>
                {suggestions.length > 0 && (
                  <div className="ai-suggestions">
                    {suggestions.map((s) => (
                      <button key={s} className="ai-chip" onClick={() => addSuggestion(s)}>
                        + {s}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="primary"
                  disabled={busy || !feedback.trim()}
                  onClick={() => generate(selected.variantId)}
                >
                  {busy ? t("ai.generating") : t("ai.regenerate")}
                </button>
              </div>

              <details className="ai-prompt-view">
                <summary>{t("ai.showPrompt")}</summary>
                <pre>{refinementPromptPreview ?? selected.prompt.text}</pre>
              </details>
              {selected.saved && <span className="muted small">{t("ai.savedHint")}</span>}
            </aside>
          )}
        </div>
      </section>
    </section>
  );
}
