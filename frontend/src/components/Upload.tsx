import { useRef, useState } from "react";
import { api, type GalleryItem } from "../api";
import { useI18n } from "../i18n";
import ScoreBadge from "./ScoreBadge";

const MAX_UPLOAD_MB = 15;
const ACCEPT = ".svg,.png,.jpg,.jpeg";
const ALLOWED = /\.(svg|png|jpe?g)$/i;

/** Public submission page served at /upload during events. */
export default function Upload() {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<GalleryItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined | null) => {
    setErr(null);
    if (!f) return;
    if (!ALLOWED.test(f.name)) {
      setErr(t("upload.badType"));
      return;
    }
    if (f.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setErr(t("upload.tooLarge", { mb: String(MAX_UPLOAD_MB) }));
      return;
    }
    setFile(f);
  };

  const submit = () => {
    if (!file || busy) return;
    setBusy(true);
    setErr(null);
    api
      .galleryUpload(file, title)
      .then((item) => {
        setResult(item);
        setFile(null);
        setTitle("");
      })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="upload-page">
      <header className="upload-head">
        <h1>
          <span className="pen">✎</span> GCodeScribe
        </h1>
        <p className="muted">{t("upload.subtitle")}</p>
      </header>

      {result ? (
        <section className="card upload-card">
          <h2>{t("upload.successTitle")}</h2>
          <div className="upload-result">
            <ScoreBadge score={result.score} />
            <div>
              <strong>{result.title || t("gallery.untitled")}</strong>
              <p className="muted">{t("upload.successBody")}</p>
            </div>
          </div>
          {result.score && (
            <ul className="upload-scores muted">
              <li>{t("score.time")}: {result.score.time}</li>
              <li>{t("score.lifts")}: {result.score.lifts}</li>
              <li>{t("score.size")}: {result.score.size}</li>
              <li>{t("score.detail")}: {result.score.detail}</li>
            </ul>
          )}
          <button className="primary" onClick={() => setResult(null)}>
            {t("upload.again")}
          </button>
        </section>
      ) : (
        <section className="card upload-card">
          <h2>{t("upload.title")}</h2>
          <p className="muted">{t("upload.hint", { mb: String(MAX_UPLOAD_MB) })}</p>

          <label className="upload-field">
            {t("upload.titleLabel")}
            <input
              type="text"
              maxLength={80}
              value={title}
              placeholder={t("upload.titlePlaceholder")}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <div
            className={`upload-drop ${dragOver ? "over" : ""} ${file ? "has-file" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => pick(e.target.files?.[0])}
            />
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span className="muted">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
              </>
            ) : (
              <>
                <strong>{t("upload.dropHint")}</strong>
                <span className="muted">{t("upload.formats")}</span>
              </>
            )}
          </div>

          {err && <div className="banner err">{err}</div>}

          <button className="primary upload-submit" disabled={!file || busy} onClick={submit}>
            {busy ? t("upload.uploading") : t("upload.submit")}
          </button>
        </section>
      )}
    </div>
  );
}
