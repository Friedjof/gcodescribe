import { useEffect, useState } from "react";
import { api, type EffectiveSettings } from "../api";
import Modal from "./Modal";
import { useI18n } from "../i18n";

type Section = "printer" | "ai" | "storage" | "auth" | "server";
const SECTIONS: Section[] = ["printer", "ai", "storage", "auth", "server"];

// Computed server-side flags — rendered read-only, never patchable.
const READONLY_FIELDS = new Set(["ai.enabled"]);

// Maps the _configured display field → the write-only patch key.
// The backend never returns the raw key; we only know if it's set.
const SECRET_KEY_MAP: Record<string, string> = {
  "ai.api_key_configured": "ai.api_key",
  "printer.octoprint_api_key_configured": "printer.octoprint_api_key",
};

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
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
      .then((d) => { setData(d); setPending({}); })
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
