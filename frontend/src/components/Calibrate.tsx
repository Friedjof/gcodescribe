import { useEffect, useState } from "react";
import { api, type Calibration } from "../api";

const FIELDS: { key: keyof Calibration; label: string; unit: string; group: string }[] = [
  { key: "bed_width", label: "Bett-Breite", unit: "mm", group: "Fläche" },
  { key: "bed_height", label: "Bett-Höhe", unit: "mm", group: "Fläche" },
  { key: "plot_width", label: "Plot-Breite", unit: "mm", group: "Fläche" },
  { key: "plot_height", label: "Plot-Höhe", unit: "mm", group: "Fläche" },
  { key: "origin_x", label: "Origin X", unit: "mm", group: "Fläche" },
  { key: "origin_y", label: "Origin Y", unit: "mm", group: "Fläche" },
  { key: "pen_up_z", label: "Stift oben (Z)", unit: "mm", group: "Stift" },
  { key: "pen_down_z", label: "Stift unten (Z)", unit: "mm", group: "Stift" },
  { key: "travel_feed", label: "Travel-Speed", unit: "mm/min", group: "Speed" },
  { key: "draw_feed", label: "Zeichen-Speed", unit: "mm/min", group: "Speed" },
  { key: "z_feed", label: "Z-Speed", unit: "mm/min", group: "Speed" },
];

const PATTERNS: [string, string][] = [
  ["frame", "Rahmen"],
  ["cross", "Kreuz"],
  ["pen", "Stift-Test"],
  ["grid", "Raster"],
];

export default function Calibrate() {
  const [cal, setCal] = useState<Calibration | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getCalibration().then(setCal).catch((e) => setErr(String(e.message)));
  }, []);

  if (!cal) return <div className="card">Lade Kalibrierung…</div>;

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
        flash("Kalibrierung gespeichert");
      })
      .catch((e) => setErr(String(e.message)));

  const importFile = (file: File) =>
    api
      .importCalibration(file)
      .then((c) => {
        setCal(c);
        flash(`Kalibrierung importiert aus „${file.name}"`);
      })
      .catch((e) => setErr(String(e.message)));

  const groups = [...new Set(FIELDS.map((f) => f.group))];

  return (
    <div className="grid">
      <section className="card">
        <h2>Kalibrierung</h2>
        {groups.map((g) => (
          <div key={g} className="field-group">
            <h3>{g}</h3>
            <div className="fields">
              {FIELDS.filter((f) => f.group === g).map((f) => (
                <label key={f.key} className="field">
                  <span>{f.label}</span>
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
          <h3>Layout</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={cal.fit_to_area}
              onChange={(e) => set("fit_to_area", e.target.checked)}
            />
            In Plotfläche einpassen (skalieren)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={cal.flip_y}
              onChange={(e) => set("flip_y", e.target.checked)}
            />
            Y spiegeln (SVG ↓ → Drucker ↑)
          </label>
        </div>
        <div className="save-row">
          <button className="primary" onClick={save}>
            Speichern
          </button>
          <a className="btn-link" href="/api/calibration/export" download>
            ↓ Export (XML)
          </a>
          <label className="btn-link">
            ↑ Import (XML)
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
        <h2>Test-Pattern</h2>
        <p className="muted">
          Erzeugt einen G-code-Job aus den aktuellen Werten — danach im Tab
          „Konvertieren &amp; Drucken“ senden.
        </p>
        <div className="pattern-grid">
          {PATTERNS.map(([id, label]) => (
            <button
              key={id}
              onClick={() =>
                api
                  .testPattern(id)
                  .then((j) => flash(`Erzeugt: ${j.filename}`))
                  .catch((e) => setErr(String(e.message)))
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
