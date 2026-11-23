import { settingsGroups } from "./settingsGroups";
import { useEffect, useState } from "react";
import type { ConfigSource, SettingsSection, SettingsPatch, SettingValue } from "../../api";
import { errorMessage } from "../../api/errors";
import { api, type EffectiveSettings } from "../../api";
import Modal from "../../components/Modal";
import { useI18n } from "../../i18n";
import PrintersPanel from "./PrintersPanel";
import CodexConnection from "./CodexConnection";
import type { PrinterStatus } from "../../api";

type Section = Exclude<SettingsSection, "gallery">;
type DisplaySource = ConfigSource | "pending";
const SECTIONS: Section[] = ["printer", "ai", "mcp", "storage", "auth", "server"];

// Computed server-side flags — rendered read-only, never patchable.
const READONLY_FIELDS = new Set(["ai.enabled"]);

// Maps the _configured display field → the write-only patch key.
// The backend never returns the raw key; we only know if it's set.
const SECRET_KEY_MAP: Record<string, string> = {
  "ai.api_key_configured": "ai.api_key",
  "printer.octoprint_api_key_configured": "printer.octoprint_api_key",
  "mcp.token_configured": "mcp.token",
};

export default function SettingsDialog({
  onClose,
  onSaved,
  status = null,
  desktop = false,
}: {
  onClose: () => void;
  onSaved?: (settings: EffectiveSettings) => void;
  status?: PrinterStatus | null;
  desktop?: boolean;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("printer");
  const [data, setData] = useState<EffectiveSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<SettingsPatch>({});
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerDirty, setPrinterDirty] = useState(false);
  const close = () => { if (!saving && !printerBusy) { if (Object.keys(pending).length || printerDirty) setDiscardOpen(true); else onClose(); } };

  const isDirty = Object.keys(pending).length > 0;

  useEffect(() => {
    api
      .getEffectiveSettings()
      .then((d) => { setData(d); setPending({}); })
      .catch((e) => setErr(errorMessage(e)));
  }, []);

  const handleChange = (key: string, value: SettingValue) => {
    if (saving) return;
    setPending((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = (sec: string, field: string) => {
    if (saving) return;
    const key = `${sec}.${field}`;
    if (key in pending) {
      setPending((prev) => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    setSaving(true);
    api
      .resetSetting(sec, field)
      .then((d) => { setData(d); onSaved?.(d); })
      .catch((e) => setErr(errorMessage(e)))
      .finally(() => setSaving(false));
  };

  const save = () => {
    if (!isDirty || saving) return;
    setSaving(true);
    // Drop secret fields left blank — empty = "keep existing key"
    const secretWriteKeys = new Set(Object.values(SECRET_KEY_MAP));
    const patch = Object.fromEntries(
      Object.entries(pending).filter(([k, v]) => !(secretWriteKeys.has(k) && v === ""))
    );
    api
      .patchSettings(patch)
      .then((d) => { setData(d); setPending({}); onSaved?.(d); })
      .catch((e) => setErr(errorMessage(e)))
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
    <>
    <Modal title={t("settings.title")} onClose={close} className="settings-modal" footer={section === "printer" ? undefined : footer}>
      <nav className="settings-nav">
        {SECTIONS.filter(s => !desktop || !["auth", "server"].includes(s)).map((s) => (
          <button
            key={s}
            disabled={saving || printerBusy || printerDirty}
            className={`settings-nav-item${section === s ? " active" : ""}`}
            onClick={() => setSection(s)}
          >
            {t(`settings.section.${s}`)}
          </button>
        ))}
      </nav>

      <fieldset className="settings-content" disabled={saving || printerBusy}>
        <div hidden={section !== "printer"}><PrintersPanel status={status} onBusyChange={setPrinterBusy} onDirtyChange={setPrinterDirty}
          onChanged={() => { api.getEffectiveSettings().then(next => { setData(next); onSaved?.(next); }).catch(error => setErr(errorMessage(error))); }} /></div>
        {!data && !err && <p className="muted">{t("common.loading")}</p>}
        {err && <p className="settings-err">{err}</p>}
        {data && section !== "printer" && (
          <SectionView
            key={section}
            section={section}
            data={data}
            pending={pending}
            onChange={handleChange}
            onReset={handleReset}
            onSettingsChange={(next) => { setData(next); onSaved?.(next); }}
          />
        )}
      </fieldset>
    </Modal>
    {discardOpen && <Modal title={t("settings.discardTitle")} onClose={() => setDiscardOpen(false)} footer={<><button onClick={() => setDiscardOpen(false)}>{t("common.cancel")}</button><button onClick={onClose} className="primary">{t("settings.discard")}</button></>}><p>{t("settings.discardHint")}</p></Modal>}
    </>
  );
}

function SectionView({
  section,
  data,
  pending,
  onChange,
  onReset,
  onSettingsChange,
}: {
  section: Section;
  data: EffectiveSettings;
  pending: SettingsPatch;
  onChange: (key: string, value: SettingValue) => void;
  onReset: (section: string, field: string) => void;
  onSettingsChange: (settings: EffectiveSettings) => void;
}) {
  const { t } = useI18n();
  const [groupId, setGroupId] = useState<string | null>(null);

  const rawSection = data[section] as SettingsPatch;
  const groups = settingsGroups(section, rawSection);
  const group = groups.find((item) => item.id === groupId) ?? groups[0];
  const aiProvider = pending["ai.provider"] ?? data.ai.provider ?? "api";

  return (
    <section className="settings-section">
      <h3 className="settings-section-heading">{t(`settings.${section}.heading`)}</h3>
      {groups.length > 1 && <nav className="settings-group-tabs" aria-label={t(`settings.section.${section}`)}>{groups.map((item) => <button type="button" key={item.id} aria-pressed={group.id === item.id} onClick={() => setGroupId(item.id)}>{t(`settings.group.${item.id}`)}</button>)}</nav>}
      <dl className="settings-rows">
        {group.fields.map(([field, value]) => {
          const key = `${section}.${field}`;
          if (section === "ai" && aiProvider === "codex" && ["api_key_configured", "model", "api_mode", "quality"].includes(field)) return null;
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

          // Normal editable field
          const fieldSource = key in pending ? "pending" : data.sources[section]?.[field];
          const effectiveValue = key in pending ? pending[key] : value;
          return (
            <EditableRow
              key={field}
              label={label}
              value={effectiveValue}
              options={key === "ai.provider" ? [{ value: "api", label: t("codex.apiOption") }, { value: "codex", label: t("codex.subscriptionOption") }] : undefined}
              source={fieldSource}
              onChange={(v) => onChange(key, v)}
              onReset={fieldSource === "saved" || fieldSource === "pending"
                ? () => onReset(section, field)
                : undefined}
            />
          );
        })}
      </dl>

      {section === "ai" && aiProvider === "codex" && group.id === "access" && <CodexConnection onChanged={() => {
        api.getEffectiveSettings().then(onSettingsChange).catch(() => {});
      }} />}
      {section === "ai" && aiProvider === "codex" && group.id === "output" && <p className="muted">{t("codex.managedModel")}</p>}

      {section === "mcp" && <McpTokenSection onSettingsChange={onSettingsChange} />}
    </section>
  );
}

function McpTokenSection({
  onSettingsChange,
}: {
  onSettingsChange: (settings: EffectiveSettings) => void;
}) {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mcpUrl = `${window.location.origin}/mcp`;
  const clientConfig = JSON.stringify({ url: mcpUrl, authorization: "Bearer <token>" }, null, 2);

  const generate = () => {
    setBusy(true);
    setMessage(null);
    api.generateMcpToken()
      .then((res) => {
        setToken(res.token);
        onSettingsChange(res.settings);
      })
      .catch((e: unknown) => setMessage(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const copy = () => {
    if (!token) return;
    navigator.clipboard?.writeText(token)
      .then(() => setMessage(t("settings.mcp.tokenCopied")))
      .catch(() => setMessage(t("settings.mcp.copyFailed")));
  };

  const copyUrl = () => {
    navigator.clipboard?.writeText(mcpUrl)
      .then(() => setMessage(t("settings.mcp.urlCopied")))
      .catch(() => setMessage(t("settings.mcp.copyFailed")));
  };

  return (
    <div className="settings-mcp-token">
      <p className="muted">{t("settings.mcp.hint")}</p>
      <div className="settings-mcp-endpoint">
        <span>{t("settings.mcp.endpoint")}</span>
        <input readOnly aria-label={t("settings.mcp.endpoint")} value={mcpUrl}/>
        <button className="ghost" onClick={copyUrl}>{t("settings.mcp.copyUrl")}</button>
      </div>
      <textarea readOnly className="settings-mcp-config" aria-label={t("settings.mcp.endpoint")} value={clientConfig}/>
      <div className="settings-mcp-actions">
        <button className="ghost" disabled={busy} onClick={generate}>
          {busy ? t("settings.mcp.generating") : t("settings.mcp.generateToken")}
        </button>
        {token && <button className="ghost" onClick={copy}>{t("settings.mcp.copyToken")}</button>}
      </div>
      {token && <input readOnly className="settings-mcp-token-value" aria-label="MCP Token" value={token}/>}
      {message && <p className="muted">{message}</p>}
    </div>
  );
}


function SecretRow({
  label,
  isConfigured,
  source,
  pendingValue,
  onChange,
}: {
  label: string;
  isConfigured: boolean;
  source?: DisplaySource;
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
          aria-label={label}
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
  options,
}: {
  label: string;
  options?: { value: string; label: string }[];
  value: unknown;
  source?: DisplaySource;
  onChange: (v: SettingValue) => void;
  onReset?: () => void;
}) {
  const { t } = useI18n();
  const isPending = source === "pending";
  const hasSaved = source === "saved";

  return (
    <>
      <dt className="settings-label">{label}</dt>
      <dd className="settings-value">
        {options ? <select className="settings-input" aria-label={label} value={String(value)} onChange={(e) => onChange(e.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <FieldInput label={label} value={value} onChange={onChange} />}
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

function FieldInput({ value, onChange, label }: { label: string; value: unknown; onChange: (v: SettingValue) => void }) {
  const { t } = useI18n();

  if (typeof value === "boolean") {
    return (
      <label className="settings-toggle">
        <input aria-label={label} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span className={value ? "settings-val ok" : "settings-val muted"}>
          {value ? t("settings.value.yes") : t("settings.value.no")}
        </span>
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <input aria-label={label}
        type="number"
        className="settings-input settings-input-num"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  return (
    <input aria-label={label}
      type="text"
      className="settings-input"
      value={String(value ?? "")}
      placeholder={t("settings.value.notSet")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function SourceBadge({ source }: { source: DisplaySource }) {
  const { t } = useI18n();
  return (
    <span className={`settings-source settings-source-${source}`}>
      {t(`settings.source.${source}`)}
    </span>
  );
}
