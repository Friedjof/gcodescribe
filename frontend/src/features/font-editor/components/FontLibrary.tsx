import { useRef, useState } from "react";
import { api, type FontItem } from "../../../api";
import { errorMessage } from "../../../api/errors";
import { useI18n } from "../../../i18n";
import { fontLabel, useTextFonts } from "../../paint/hooks/useTextFonts";
import PaginationBar from "../../../components/paging/PaginationBar";
import { useFitListPage } from "../../../components/paging/useFitListPage";

export default function FontLibrary({protectedFontId}:{protectedFontId?:string|null}) {
  const { t } = useI18n();
  const [fontTab, setFontTab] = useState("library");
  const { fonts, loading, error, reload, setFonts } = useTextFonts();
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"plotter" | "normal">("plotter");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const exportStrokeFont = (font: FontItem) => {
    setLocalError(null);
    api.exportStrokeFont(font.id, font.label).catch((e) => setLocalError(errorMessage(e)));
  };

  const importStrokeFont = (importFile: File | null) => {
    if (!importFile || busy) return;
    setBusy(true);
    setLocalError(null);
    api.importStrokeFont(importFile)
      .then(() => reload())
      .catch((e) => setLocalError(errorMessage(e)))
      .finally(() => {
        setBusy(false);
        if (importRef.current) importRef.current.value = "";
      });
  };

  const add = () => {
    if (!file || busy) return;
    setBusy(true);
    setLocalError(null);
    api.uploadFont(label || file.name.replace(/\.[^.]+$/, ""), file, mode)
      .then((res) => {
        setFonts(res.fonts);
        setLabel("");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      })
      .catch((e) => setLocalError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const remove = (font: FontItem) => {
    if (font.builtin || busy || font.id===protectedFontId) return;
    setBusy(true);
    setLocalError(null);
    api.deleteFont(font.id)
      .then((res) => setFonts(res.fonts))
      .catch((e) => setLocalError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const paging = useFitListPage(fonts, 45, 6);

  return (
    <section className="settings-section">
      <h3 className="settings-section-heading">{t("settings.fonts.heading")}</h3>
      <p className="muted">{t("settings.fonts.help")}</p>
      {(error || localError) && <p className="settings-err">{localError ?? error}</p>}

      <nav className="settings-group-tabs"><button type="button" aria-pressed={fontTab === "library"} onClick={() => setFontTab("library")}>{t("settings.fonts.library")}</button><button type="button" aria-pressed={fontTab === "import"} onClick={() => setFontTab("import")}>{t("settings.fonts.add")}</button></nav>
      <div hidden={fontTab !== "import"} className="settings-font-import">
      <div className="settings-font-block">
        <span className="muted">{t("settings.fonts.uploadHint")}</span>
        <input
          type="text"
          className="settings-input"
          value={label}
          placeholder={t("settings.fonts.labelPlaceholder")}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="settings-font-row">
          <input
            ref={fileRef}
            type="file"
            accept=".otf,.ttf,font/otf,font/ttf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <select
            className="settings-input settings-font-mode-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as "plotter" | "normal")}
          >
            <option value="plotter">{t("settings.fonts.mode.plotter")}</option>
            <option value="normal">{t("settings.fonts.mode.normal")}</option>
          </select>
          <button className="primary" disabled={!file || busy} onClick={add}>
            {busy ? t("settings.fonts.saving") : t("settings.fonts.add")}
          </button>
        </div>
      </div>

      <div className="settings-font-block">
        <span className="muted">{t("settings.fonts.importHint")}</span>
        <input
          ref={importRef}
          type="file"
          accept=".gcsfont,application/json"
          disabled={busy}
          onChange={(e) => importStrokeFont(e.target.files?.[0] ?? null)}
        />
      </div>

      </div>
      <div hidden={fontTab !== "library"} className="settings-font-library">
      <div className="settings-font-viewport" ref={paging.viewport}>
      <ul className="settings-font-list">
        {paging.items.map((font) => (
          <li key={font.id} className="settings-font-item">
            <span className="settings-font-name">{fontLabel(font, t)}</span>
            <span className="settings-source settings-source-default">
              {font.builtin ? t("settings.fonts.builtin") : t("settings.fonts.custom")}
            </span>
            <span className={`settings-source ${font.mode === "plotter" ? "settings-source-saved" : "settings-source-default"}`}>
              {font.mode === "plotter"
                ? t("settings.fonts.optimized")
                : t("settings.fonts.normal")}
            </span>
            {font.kind === "stroke" && (
              <button className="ghost" disabled={busy} onClick={() => exportStrokeFont(font)}>
                {t("settings.fonts.export")}
              </button>
            )}
            {!font.builtin && (
              <button className="ghost" disabled={busy || font.id===protectedFontId} title={font.id===protectedFontId?t("fontWorkspace.closeBeforeDelete"):undefined} onClick={() => remove(font)}>
                {t("settings.fonts.remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
      </div>
      <PaginationBar page={paging.page} pages={paging.pages} onChange={paging.setPage} label={t("settings.fonts.heading")}/>
      {loading && <p className="muted">{t("common.loading")}</p>}
      <button className="ghost" disabled={loading || busy} onClick={reload}>{t("settings.fonts.reload")}</button>
      </div>
    </section>
  );
}

// ── Row variants ─────────────────────────────────────────────────────────────
