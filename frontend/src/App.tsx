import { useEffect, useState } from "react";
import { api } from "./api";
import Convert from "./components/Convert";
import Place from "./components/Place";
import Paint from "./components/Paint";
import Calibrate from "./components/Calibrate";
import Control from "./components/Control";
import Paper from "./components/Paper";
import Segmented from "./components/Segmented";
import { useI18n } from "./i18n";

type Tab = "place" | "paint" | "convert" | "paper" | "calibrate" | "control";

export default function App() {
  const { lang, setLang, t } = useI18n();
  const [tab, setTab] = useState<Tab>("place");
  const [status, setStatus] = useState<any>(null);

  const refreshStatus = () => api.octoStatus().then(setStatus).catch(() => setStatus(null));

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 4000);
    return () => clearInterval(id);
  }, []);

  const tabs: { value: Tab; label: string }[] = [
    { value: "place", label: t("tabs.place") },
    { value: "paint", label: t("tabs.paint") },
    { value: "convert", label: t("tabs.jobs") },
    { value: "paper", label: t("tabs.paper") },
    { value: "calibrate", label: t("tabs.calibrate") },
    { value: "control", label: t("tabs.control") },
  ];

  return (
    <div className={`app tab-${tab}`}>
      <header>
        <h1>
          <span className="pen">✎</span> GCodeScribe
        </h1>
        <div className="header-actions">
          <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value as "de" | "en" | "ba" | "fr" | "es")}>
            <option value="de">{t("lang.de")}</option>
            <option value="en">{t("lang.en")}</option>
            <option value="ba">{t("lang.ba")}</option>
            <option value="fr">{t("lang.fr")}</option>
            <option value="es">{t("lang.es")}</option>
          </select>
          <StatusPill status={status} />
        </div>
      </header>

      <nav className="tabs-nav">
        <Segmented<Tab> className="nav" value={tab} onChange={setTab} options={tabs} />
      </nav>

      <main>
        {tab === "place" && <Place status={status} onAction={refreshStatus} />}
        {tab === "paint" && <Paint />}
        {tab === "convert" && <Convert status={status} onAction={refreshStatus} />}
        {tab === "paper" && <Paper status={status} onAction={refreshStatus} />}
        {tab === "calibrate" && <Calibrate />}
        {tab === "control" && <Control status={status} onAction={refreshStatus} />}
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: any }) {
  const { t } = useI18n();
  if (!status) return <span className="pill off">{t("status.backendOffline")}</span>;
  if (!status.configured)
    return <span className="pill warn">{t("status.octoUnconfigured")}</span>;
  if (!status.online) return <span className="pill off">{t("status.octoOffline")}</span>;
  const state = status.printer?.state?.text ?? status.connection?.state ?? t("status.connected");
  const printing = status.job?.state?.toLowerCase?.().includes("printing");
  return (
    <span className={`pill ${printing ? "busy" : "ok"}`}>
      ● {state}
    </span>
  );
}
