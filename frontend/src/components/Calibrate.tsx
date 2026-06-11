import { useEffect, useState } from "react";
import { api, type Calibration } from "../api";
import { useI18n } from "../i18n";

const FIELDS: { key: keyof Calibration; labelKey: string; unit: string; groupKey: string }[] = [
  { key: "bed_width", labelKey: "calibrate.bedWidth", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "bed_height", labelKey: "calibrate.bedHeight", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "plot_width", labelKey: "calibrate.plotWidth", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "plot_height", labelKey: "calibrate.plotHeight", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "origin_x", labelKey: "calibrate.originX", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "origin_y", labelKey: "calibrate.originY", unit: "mm", groupKey: "calibrate.groupArea" },
  { key: "pen_up_z", labelKey: "calibrate.penUpZ", unit: "mm", groupKey: "calibrate.groupPen" },
  { key: "pen_down_z", labelKey: "calibrate.penDownZ", unit: "mm", groupKey: "calibrate.groupPen" },
  { key: "travel_feed", labelKey: "calibrate.travelFeed", unit: "mm/min", groupKey: "calibrate.groupSpeed" },
  { key: "draw_feed", labelKey: "calibrate.drawFeed", unit: "mm/min", groupKey: "calibrate.groupSpeed" },
  { key: "z_feed", labelKey: "calibrate.zFeed", unit: "mm/min", groupKey: "calibrate.groupSpeed" },
];

const PATTERNS: [string, string][] = [
  ["frame", "calibrate.patFrame"],
  ["cross", "calibrate.patCross"],
  ["pen", "calibrate.patPen"],
  ["grid", "calibrate.patGrid"],
];

export default function Calibrate() {
  const { t } = useI18n();
  const [cal, setCal] = useState<Calibration | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getCalibration().then(setCal).catch((e) => setErr(String(e.message)));
  }, []);

  if (!cal) return <div className="card">{t("calibrate.loading")}</div>;

  const set = (k: keyof Calibration, v: number | boolean) =>
    setCal({ ...cal, [k]: v });

  const flash = (m: string) => {
    setMsg(m);
    setErr(null);
    setTimeout(() => setMsg(null), 3000);
  };

  const save = () =>
    api
      .saveCalibration(cal)
      .then((c) => {
        setCal(c);
        flash(t("calibrate.saved"));
      })
      .catch((e) => setErr(String(e.message)));

  const importFile = (file: File) =>
    api
      .importCalibration(file)
      .then((c) => {
        setCal(c);
        flash(t("calibrate.imported", { name: file.name }));
      })
      .catch((e) => setErr(String(e.message)));

  const groups = [...new Set(FIELDS.map((f) => f.groupKey))];

  return (
    <div className="grid">
      <section className="card">
        <h2>{t("calibrate.title")}</h2>
        {groups.map((g) => (
          <div key={g} className="field-group">
            <h3>{t(g)}</h3>
            <div className="fields">
              {FIELDS.filter((f) => f.groupKey === g).map((f) => (
                <label key={f.key} className="field">
                  <span>{t(f.labelKey)}</span>
                  <div className="input-unit">
                    <input
                      type="number"
                      step="0.1"
                      value={cal[f.key] as number}
                      onChange={(e) => set(f.key, parseFloat(e.target.value) || 0)}
                    />
                    <em>{f.unit}</em>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="field-group">
          <h3>{t("calibrate.layout")}</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={cal.fit_to_area}
              onChange={(e) => set("fit_to_area", e.target.checked)}
            />
            {t("calibrate.fitToArea")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={cal.flip_y}
              onChange={(e) => set("flip_y", e.target.checked)}
            />
            {t("calibrate.flipY")}
          </label>
        </div>
        <div className="save-row">
          <button className="primary" onClick={save}>
            {t("common.save")}
          </button>
          <a className="btn-link" href="/api/calibration/export" download>
            {t("common.exportXml")}
          </a>
          <label className="btn-link">
            {t("common.importXml")}
            <input
              type="file"
              accept=".xml,application/xml,text/xml"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {msg && <div className="banner ok">{msg}</div>}
        {err && <div className="banner err">{err}</div>}
      </section>

      <section className="card">
        <h2>{t("calibrate.testPattern")}</h2>
        <p className="muted">{t("calibrate.testHint")}</p>
        <div className="pattern-grid">
          {PATTERNS.map(([id, labelKey]) => (
            <button
              key={id}
              onClick={() =>
                api
                  .testPattern(id)
                  .then((j) => flash(t("calibrate.generated", { file: j.filename })))
                  .catch((e) => setErr(String(e.message)))
              }
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
