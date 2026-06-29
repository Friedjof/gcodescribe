import { useEffect, useRef, useState } from "react";
import { api, type EffectiveSettings, type FontItem, type SerialPortCandidate } from "../api";
import Modal from "./Modal";
import { useI18n } from "../i18n";
import { fontLabel, useTextFonts } from "../paint/useTextFonts";

type Section = "printer" | "ai" | "fonts" | "storage" | "auth" | "server";
const SECTIONS: Section[] = ["printer", "ai", "fonts", "storage", "auth", "server"];

// Computed server-side flags — rendered read-only, never patchable.
const READONLY_FIELDS = new Set(["ai.enabled"]);

// Maps the _configured display field → the write-only patch key.
// The backend never returns the raw key; we only know if it's set.
const SECRET_KEY_MAP: Record<string, string> = {
  "ai.api_key_configured": "ai.api_key",
  "printer.octoprint_api_key_configured": "printer.octoprint_api_key",
};

export default function SettingsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: (settings: EffectiveSettings) => void;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("printer");
  const [data, setData] = useState<EffectiveSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const isDirty = Object.keys(pending).length > 0;

  useEffect(() => {
    api
      .getEffectiveSettings()
      .then((d) => { setData(d); setPending({}); })
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  const handleChange = (key: string, value: unknown) => {
    setPending((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = (sec: string, field: string) => {
    const key = `${sec}.${field}`;
    if (key in pending) {
      setPending((prev) => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    api
      .resetSetting(sec, field)
      .then((d) => setData(d))
      .catch((e) => setErr(String(e.message ?? e)));
  };

  const save = () => {
    if (!isDirty) return;
    setSaving(true);
    // Drop secret fields left blank — empty = "keep existing key"
    const secretWriteKeys = new Set(Object.values(SECRET_KEY_MAP));
    const patch = Object.fromEntries(
      Object.entries(pending).filter(([k, v]) => !(secretWriteKeys.has(k) && v === ""))
    );
    api
      .patchSettings(patch)
      .then((d) => { setData(d); setPending({}); onSaved?.(d); })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setSaving(false));
  };

  const cancel = () => { setPending({}); setErr(null); };

  const footer = (
    <>
      {isDirty && (
        <button onClick={cancel} disabled={saving}>
          {t("common.cancel")}
        </button>
      )}
      <button className="primary" onClick={save} disabled={!isDirty || saving}>
        {saving ? t("settings.saving") : t("common.save")}
      </button>
    </>
  );

  return (
    <Modal title={t("settings.title")} onClose={onClose} className="settings-modal" footer={footer}>
      <nav className="settings-nav">
        {SECTIONS.map((s) => (
          <button
            key={s}
            className={`settings-nav-item${section === s ? " active" : ""}`}
            onClick={() => setSection(s)}
          >
            {t(`settings.section.${s}`)}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        {!data && !err && <p className="muted">{t("common.loading")}</p>}
        {err && <p className="settings-err">{err}</p>}
        {data && (
          <SectionView
            section={section}
            data={data}
            pending={pending}
            onChange={handleChange}
            onReset={handleReset}
          />
        )}
      </div>
    </Modal>
  );
}

function SectionView({
  section,
  data,
  pending,
  onChange,
  onReset,
}: {
  section: Section;
  data: EffectiveSettings;
  pending: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onReset: (section: string, field: string) => void;
}) {
  const { t } = useI18n();
  if (section === "fonts") return <FontSettingsSection />;

  const rawSection = data[section] as Record<string, unknown>;

  return (
    <section className="settings-section">
      <h3 className="settings-section-heading">{t(`settings.${section}.heading`)}</h3>
      <dl className="settings-rows">
        {Object.entries(rawSection).map(([field, value]) => {
          const key = `${section}.${field}`;
          const label = t(`settings.${section}.${field}`);

          // Secret field: show stars + overwrite input
          if (key in SECRET_KEY_MAP) {
            const writeKey = SECRET_KEY_MAP[key];
            const writeField = writeKey.split(".")[1];
            const keySource = data.sources[section]?.[writeField];
            const pendingVal = pending[writeKey] as string | undefined;
            return (
              <SecretRow
                key={field}
                label={label}
                isConfigured={Boolean(value)}
                source={keySource}
                pendingValue={pendingVal ?? ""}
                onChange={(v) => onChange(writeKey, v)}
              />
            );
          }

          // Computed read-only field
          if (READONLY_FIELDS.has(key)) {
            return (
              <ReadonlyRow key={field} label={label} value={value} />
            );
          }

          // Special: serial port with USB scan picker
          if (key === "printer.serial_port") {
            const fieldSource = key in pending ? "pending" : data.sources[section]?.[field];
            const effectiveValue = (key in pending ? pending[key] : value) as string;
            return (
              <SerialPortRow
                key={field}
                label={label}
                value={effectiveValue}
                source={fieldSource}
                onChange={(v) => onChange(key, v)}
                onReset={fieldSource === "saved" || fieldSource === "pending"
                  ? () => onReset(section, field)
                  : undefined}
              />
            );
          }

          // Normal editable field
          const fieldSource = key in pending ? "pending" : data.sources[section]?.[field];
          const effectiveValue = key in pending ? pending[key] : value;
          return (
            <EditableRow
              key={field}
              label={label}
              value={effectiveValue}
              source={fieldSource}
              onChange={(v) => onChange(key, v)}
              onReset={fieldSource === "saved" || fieldSource === "pending"
                ? () => onReset(section, field)
                : undefined}
            />
          );
        })}
      </dl>

      {section === "printer" && <OctoPrintCheckSection />}
    </section>
  );
}

function FontSettingsSection() {
  const { t } = useI18n();
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
    api.exportStrokeFont(font.id, font.label).catch((e) => setLocalError(String(e.message ?? e)));
  };

  const importStrokeFont = (importFile: File | null) => {
    if (!importFile || busy) return;
    setBusy(true);
    setLocalError(null);
    api.importStrokeFont(importFile)
      .then(() => reload())
      .catch((e) => setLocalError(String(e.message ?? e)))
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
      .catch((e) => setLocalError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };

  const remove = (font: FontItem) => {
    if (font.builtin || busy) return;
    setBusy(true);
    setLocalError(null);
    api.deleteFont(font.id)
      .then((res) => setFonts(res.fonts))
      .catch((e) => setLocalError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="settings-section">
      <h3 className="settings-section-heading">{t("settings.fonts.heading")}</h3>
      <p className="muted">{t("settings.fonts.help")}</p>
      {(error || localError) && <p className="settings-err">{localError ?? error}</p>}

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

      <ul className="settings-font-list">
        {fonts.map((font) => (
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
              <button className="ghost" disabled={busy} onClick={() => remove(font)}>
                {t("settings.fonts.remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {loading && <p className="muted">{t("common.loading")}</p>}
      <button className="ghost" disabled={loading || busy} onClick={reload}>{t("settings.fonts.reload")}</button>
    </section>
  );
}

// ── Row variants ─────────────────────────────────────────────────────────────

function SecretRow({
  label,
  isConfigured,
  source,
  pendingValue,
  onChange,
}: {
  label: string;
  isConfigured: boolean;
  source?: string;
  pendingValue: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  const hasPending = pendingValue !== "";

  return (
    <>
      <dt className="settings-label">{label}</dt>
      <dd className="settings-value settings-value-secret">
        <span className={isConfigured ? "settings-val ok" : "settings-val muted"}>
          {isConfigured ? "●●●●●●" : t("settings.value.notConfigured")}
        </span>
        {source && !hasPending && <SourceBadge source={source} />}
        <input
          type="password"
          className="settings-input settings-input-secret"
          value={pendingValue}
          placeholder={t("settings.secretPlaceholder")}
          autoComplete="new-password"
          onChange={(e) => onChange(e.target.value)}
        />
        {hasPending && <SourceBadge source="pending" />}
      </dd>
    </>
  );
}

function ReadonlyRow({ label, value }: { label: string; value: unknown }) {
  const { t } = useI18n();
  const display = (() => {
    if (typeof value === "boolean")
      return value
        ? <span className="settings-val ok">{t("settings.value.yes")}</span>
        : <span className="settings-val muted">{t("settings.value.no")}</span>;
    if (value === "" || value == null)
      return <span className="settings-val muted">{t("settings.value.notSet")}</span>;
    return <span className="settings-val">{String(value)}</span>;
  })();

  return (
    <>
      <dt className="settings-label settings-label-muted">{label}</dt>
      <dd className="settings-value">{display}</dd>
    </>
  );
}

function EditableRow({
  label,
  value,
  source,
  onChange,
  onReset,
}: {
  label: string;
  value: unknown;
  source?: string;
  onChange: (v: unknown) => void;
  onReset?: () => void;
}) {
  const { t } = useI18n();
  const isPending = source === "pending";
  const hasSaved = source === "saved";

  return (
    <>
      <dt className="settings-label">{label}</dt>
      <dd className="settings-value">
        <FieldInput value={value} onChange={onChange} />
        {(hasSaved || isPending) && onReset && (
          <button className="settings-reset ghost" onClick={onReset} title={t("settings.resetField")}>
            ↺
          </button>
        )}
        {source && source !== "pending" && <SourceBadge source={source} />}
        {isPending && <SourceBadge source="pending" />}
      </dd>
    </>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function FieldInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useI18n();

  if (typeof value === "boolean") {
    return (
      <label className="settings-toggle">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span className={value ? "settings-val ok" : "settings-val muted"}>
          {value ? t("settings.value.yes") : t("settings.value.no")}
        </span>
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <input
        type="number"
        className="settings-input settings-input-num"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  return (
    <input
      type="text"
      className="settings-input"
      value={String(value ?? "")}
      placeholder={t("settings.value.notSet")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function SourceBadge({ source }: { source: string }) {
  const { t } = useI18n();
  return (
    <span className={`settings-source settings-source-${source}`}>
      {t(`settings.source.${source}`)}
    </span>
  );
}

// ── Serial port picker ────────────────────────────────────────────────────────

function SerialPortRow({
  label, value, source, onChange, onReset,
}: {
  label: string;
  value: string;
  source?: string;
  onChange: (v: string) => void;
  onReset?: () => void;
}) {
  const { t } = useI18n();
  const [ports, setPorts] = useState<SerialPortCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const scan = () => {
    setScanning(true);
    api.listSerialPorts()
      .then(setPorts)
      .catch(() => setPorts([]))
      .finally(() => setScanning(false));
  };

  const select = (device: string) => {
    onChange(device);
    setPorts(null);
  };

  return (
    <>
      <dt className="settings-label">{label}</dt>
      <dd className="settings-value settings-serial-dd">
        <div className="settings-serial-row">
          <input
            type="text"
            className="settings-input settings-serial-input"
            value={value}
            placeholder="/dev/ttyUSB0"
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            className="settings-serial-scan"
            disabled={scanning}
            onClick={scan}
          >
            {scanning ? t("settings.printer.scanning") : t("settings.printer.scanPorts")}
          </button>
          {(source === "saved" || source === "pending") && onReset && (
            <button className="settings-reset ghost" onClick={onReset} title={t("settings.resetField")}>↺</button>
          )}
          {source && source !== "pending" && <SourceBadge source={source} />}
          {source === "pending" && <SourceBadge source="pending" />}
        </div>
        {ports !== null && (
          <ul className="settings-serial-list">
            {ports.length === 0 ? (
              <li className="settings-serial-empty">{t("serial.noPorts")}</li>
            ) : (
              ports.map((p) => (
                <li key={p.device} className="settings-serial-port" onClick={() => select(p.device)}>
                  <code>{p.device}</code>
                  {p.description && <span className="settings-serial-desc">{p.description}</span>}
                  {p.likelyPrinter && (
                    <span className="settings-serial-badge">{t("serial.likelyPrinter")}</span>
                  )}
                </li>
              ))
            )}
          </ul>
        )}
      </dd>
    </>
  );
}

// ── OctoPrint connection check ────────────────────────────────────────────────

function OctoPrintCheckSection() {
  const { t } = useI18n();
  const [result, setResult] = useState<{
    ok: boolean; version?: string; api?: string; error?: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);

  const check = () => {
    setChecking(true);
    setResult(null);
    api.octoprintCheck()
      .then(setResult)
      .catch((e: Error) => setResult({ ok: false, error: String(e.message ?? e) }))
      .finally(() => setChecking(false));
  };

  return (
    <div className="settings-octo-check">
      <button onClick={check} disabled={checking} className="settings-octo-btn">
        {checking ? t("settings.printer.checking") : t("settings.printer.checkConnection")}
      </button>
      {result && (
        <span className={`settings-octo-result ${result.ok ? "ok" : "err"}`}>
          {result.ok
            ? t("settings.printer.checkOk", { version: result.version ?? "?" })
            : (result.error ?? t("settings.printer.checkFail"))}
        </span>
      )}
    </div>
  );
}
