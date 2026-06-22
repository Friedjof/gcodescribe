import { useEffect, useRef, useState } from "react";
import { api, type AiImageResult, type AiImageStatus } from "../api";
import { useI18n } from "../i18n";
import { galleryPageObject } from "../paint/insertAsset";
import PolylinePreview from "./PolylinePreview";
import Segmented from "./Segmented";

type RenderMode = "edges" | "handwriting" | "trace";

/** The AI Designer tab: upload a reference image, generate a plotter-ready
 * line drawing (persisted as a gallery asset), inspect its traced preview and
 * plottability, then open it straight in the designer. */
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
  const [renderMode, setRenderMode] = useState<RenderMode>("edges");
  const [detail, setDetail] = useState(2);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AiImageResult | null>(null);
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

  const generate = () => {
    if (!file || busy) return;
    setBusy(true);
    setErr(null);
    api
      .aiImageGenerate(file, { instructions, renderMode, detail })
      .then(setResult)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };

  const toDesigner = () => {
    if (!result || importing) return;
    setImporting(true);
    setErr(null);
    const { galleryItem, preview } = result;
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

  const quality = result?.quality;
  const complexityLabel = quality ? t(`ai.quality.${quality.complexity}`) : "";

  return (
    <section className={`ai-designer ${visible ? "" : "hidden"}`.trim()}>
      <div className="ai-grid">
        {/* Input column */}
        <div className="card ai-input">
          <h2>{t("ai.title")}</h2>
          <p className="muted">{t("ai.subtitle")}</p>

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

          <div className="ai-style">
            <strong>{t("ai.styleTitle")}</strong>
            <p className="muted small">{t("ai.styleHint")}</p>
          </div>

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

          <button className="primary" disabled={!file || busy} onClick={generate}>
            {busy ? t("ai.generating") : t("ai.generate")}
          </button>
          <p className="muted small ai-cost">{t("ai.costHint")}</p>
          {err && <div className="banner err">{err}</div>}
        </div>

        {/* Result column */}
        <div className="card ai-result">
          {!result ? (
            <div className="ai-empty">
              <span className="ai-empty-icon">✎</span>
              <h3>{t("ai.emptyTitle")}</h3>
              <p className="muted">{t("ai.emptyHint")}</p>
            </div>
          ) : (
            <>
              <div className="ai-images">
                <figure>
                  <figcaption className="muted small">{t("ai.resultSource")}</figcaption>
                  {previewUrl ? <img src={previewUrl} alt="" /> : <div className="ai-ph" />}
                </figure>
                <figure>
                  <figcaption className="muted small">{t("ai.resultOutput")}</figcaption>
                  <img src={result.imageUrl} alt="" />
                </figure>
                <figure>
                  <figcaption className="muted small">{t("ai.resultLines")}</figcaption>
                  <PolylinePreview data={result.preview} className="ai-poly" />
                </figure>
              </div>

              <div className={`ai-quality ${quality?.complexity}`}>
                <span className="ai-badge">{complexityLabel}</span>
                <span className="muted small">
                  {t("ai.qualityStats", {
                    lines: quality?.lineCount ?? 0,
                    points: quality?.pointCount ?? 0,
                  })}
                </span>
              </div>
              {quality?.warnings.map((w) => (
                <div key={w} className="banner warn">
                  {w}
                </div>
              ))}

              <div className="ai-actions">
                <button className="primary" disabled={importing} onClick={toDesigner}>
                  {importing ? t("common.loading") : t("ai.openDesigner")}
                </button>
                <span className="muted small">{t("ai.savedHint")}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
