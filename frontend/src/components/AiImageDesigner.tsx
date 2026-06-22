import { useEffect, useRef, useState } from "react";
import { api, type AiImageResult, type AiImageStatus } from "../api";
import { useI18n } from "../i18n";
import { galleryPageObject } from "../paint/insertAsset";
import PolylinePreview from "./PolylinePreview";
import Segmented from "./Segmented";

type RenderMode = "edges" | "handwriting" | "trace";

/** The AI Designer tab: upload a reference image, generate a plotter-ready
 * line drawing (persisted as a gallery asset), then refine it with feedback
 * into further variants. Each variant can be opened straight in the designer. */
export default function AiImageDesigner({
  status,
  visible = true,
  onOpenPaint,
}: {
  status: AiImageStatus | null;
  visible?: boolean;
  onOpenPaint: () => void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [feedback, setFeedback] = useState("");
  const [renderMode, setRenderMode] = useState<RenderMode>("edges");
  const [detail, setDetail] = useState(2);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [variants, setVariants] = useState<AiImageResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const maxMb = status?.maxInputMb ?? 10;
  const selected = variants.find((v) => v.variantId === selectedId) ?? null;

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
    setFile(f);
  };

  // baseVariantId set → a feedback refinement (no re-upload); else first pass.
  const generate = (baseVariantId?: string) => {
    if (busy) return;
    if (!baseVariantId && !file) return;
    if (baseVariantId && !feedback.trim()) return;
    setBusy(true);
    setErr(null);
    api
      .aiImageGenerate(baseVariantId ? null : file, {
        instructions,
        feedback: baseVariantId ? feedback : "",
        baseVariantId,
        renderMode,
        detail,
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

  const addSuggestion = (s: string) =>
    setFeedback((f) => (f.trim() ? `${f.trim()} ${s}` : s));

  const quality = selected?.quality;
  const suggestions = quality?.feedbackSuggestions ?? [];

  // Live preview of the prompt that will be sent: the selected mode's style plus
  // the typed instructions. Updates as the mode or instructions change.
  const promptPreview = (() => {
    const base = status?.stylePrompts?.[renderMode];
    if (!base) return null;
    const extra = instructions.trim();
    return extra ? `${base}\n\nUser instructions: ${extra}` : base;
  })();

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
          {t("ai.instructionsLabel")}
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

        <label className="ai-field">
          {t("ai.detail")}
          <Segmented<number>
            className="nav"
            value={detail}
            onChange={setDetail}
            options={[
              { value: 1, label: "1" },
              { value: 2, label: "2" },
              { value: 3, label: "3" },
            ]}
          />
        </label>

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

        <button className="primary" disabled={!file || busy} onClick={() => generate()}>
          {busy && !selected ? t("ai.generating") : t("ai.generate")}
        </button>
        <p className="muted small ai-cost">{t("ai.costHint")}</p>
        {err && <div className="banner err">{err}</div>}
      </aside>

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
                <pre>{selected.prompt.text}</pre>
              </details>
              <span className="muted small">{t("ai.savedHint")}</span>
            </aside>
          )}
        </div>
      </section>
    </section>
  );
}
