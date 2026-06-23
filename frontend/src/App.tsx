import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, type AiImageStatus, type AuthSession, type AuthSetupStart } from "./api";
import AiImageDesigner from "./components/AiImageDesigner";
import Convert from "./components/Convert";
import Paint from "./components/Paint";
import Games from "./components/Games";
import Gallery from "./components/Gallery";
import Calibrate from "./components/Calibrate";
import Control from "./components/Control";
import Paper from "./components/Paper";
import Segmented from "./components/Segmented";
import SettingsDialog from "./components/SettingsDialog";
import { useToasts } from "./components/Toasts";
import { useI18n } from "./i18n";

type Tab = "paint" | "games" | "gallery" | "ai" | "convert" | "paper" | "calibrate" | "control";

export default function App() {
  return (
    <AuthGate>
      <AdminApp />
    </AuthGate>
  );
}

// Heavy, stateful tabs: mount once on first visit and keep them alive (hidden)
// so switching back is instant instead of refetching + rebuilding the canvas.
// The lighter list/state tabs stay unmount-on-switch so they reflect fresh data.
const KEEP_ALIVE: Tab[] = ["paint", "games", "gallery", "ai", "convert", "paper", "calibrate"];
const PLOT_PROGRESS_THRESHOLDS = [25, 50, 90, 100];

function AdminApp() {
  const { lang, setLang, t } = useI18n();
  const toast = useToasts();
  const [tab, setTab] = useState<Tab>("paint");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(["paint"]));
  const [status, setStatus] = useState<any>(null);
  const [aiStatus, setAiStatus] = useState<AiImageStatus | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const progressNotify = useRef<{
    jobKey: string | null;
    notified: Set<number>;
    lastProgress: number | null;
    wasPrinting: boolean;
  }>({ jobKey: null, notified: new Set(), lastProgress: null, wasPrinting: false });

  useEffect(() => {
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);

  // The AI Designer tab is server-gated: only shown when the backend reports a
  // configured OpenAI key (or fake mode). Checked once after login.
  useEffect(() => {
    api.aiImageStatus().then(setAiStatus).catch(() => setAiStatus(null));
  }, []);

  const notificationsActive = notificationPermission === "granted";
  const refreshStatus = () => api.octoStatus().then(setStatus).catch(() => setStatus(null));

  useEffect(() => {
    refreshStatus();
    // Don't poll a (possibly slow) printer while the tab is backgrounded unless
    // browser notifications are enabled; then polling must continue so progress
    // milestones can fire while the app is not visible.
    const id = setInterval(() => {
      if (!document.hidden || notificationsActive) refreshStatus();
    }, 4000);
    const onVisible = () => {
      if (!document.hidden) refreshStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [notificationsActive]);

  const requestNotifications = () => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      toast.warn(t("notify.unsupported"));
      return;
    }
    Notification.requestPermission().then((permission) => {
      setNotificationPermission(permission);
      if (permission === "granted") toast.success(t("notify.enabled"));
      else toast.warn(t("notify.denied"));
    });
  };

  useEffect(() => {
    const tracker = progressNotify.current;
    const job = status?.job;
    const jobKey = job?.job?.file?.name ?? null;
    const state = String(job?.state ?? "").toLowerCase();
    const printing = !!job && state.includes("printing");
    const rawProgress = job?.progress?.completion;
    const progress = typeof rawProgress === "number" && Number.isFinite(rawProgress)
      ? Math.max(0, Math.min(100, rawProgress))
      : null;

    const notifyMilestone = (pct: number, key = tracker.jobKey) => {
      if (!key || tracker.notified.has(pct)) return;
      tracker.notified.add(pct);
      const message = pct >= 100
        ? t("notify.plotDone")
        : t("notify.plotProgress", { pct });
      toast.success(message);
      if (notificationPermission === "granted") {
        new Notification(t("notify.title"), {
          body: message,
          tag: `gcodescribe-plot-${key}`,
        });
      }
    };

    if (!job && tracker.wasPrinting && (tracker.lastProgress ?? 0) >= 90) {
      notifyMilestone(100);
    }

    if (jobKey !== tracker.jobKey) {
      tracker.jobKey = jobKey;
      tracker.notified = new Set();
      tracker.lastProgress = null;
      tracker.wasPrinting = false;
    }

    if (printing && progress != null) {
      const crossed = PLOT_PROGRESS_THRESHOLDS.filter(
        (pct) => pct <= progress && !tracker.notified.has(pct)
      );
      const next = crossed[crossed.length - 1];
      if (next != null) notifyMilestone(next);
      tracker.lastProgress = progress;
    }
    tracker.wasPrinting = printing;
  }, [notificationPermission, status, t, toast]);

  const tabs: { value: Tab; label: string }[] = [
    { value: "paint", label: t("tabs.paint") },
    ...(aiStatus?.enabled ? [{ value: "ai" as Tab, label: t("tabs.ai") }] : []),
    { value: "games", label: t("tabs.games") },
    { value: "gallery", label: t("tabs.gallery") },
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
          {notificationPermission !== "unsupported" && notificationPermission !== "granted" && (
            <button className="notify-enable" onClick={requestNotifications} title={t("notify.enableHint")}>
              {t("notify.enable")}
            </button>
          )}
          <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value as "de" | "ba" | "en" | "fr" | "es")}>
            <option value="de">{t("lang.de")}</option>
            <option value="ba">{t("lang.ba")}</option>
            <option value="en">{t("lang.en")}</option>
            <option value="fr">{t("lang.fr")}</option>
            <option value="es">{t("lang.es")}</option>
          </select>
          <button className="settings-btn" onClick={() => setSettingsOpen(true)} title={t("settings.headerButton")}>⚙</button>
          <StatusPill status={status} />
        </div>
      </header>

      <nav className="tabs-nav">
        <Segmented<Tab> className="nav" value={tab} onChange={setTab} options={tabs} />
      </nav>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      <main>
        {/* Kept alive: rendered once visited, hidden (not unmounted) when inactive.
            `display: contents` keeps the layout/height chain identical to before. */}
        {KEEP_ALIVE.map((value) =>
          visited.has(value) ? (
            <div key={value} style={{ display: tab === value ? "contents" : "none" }}>
              {value === "paint" && <Paint visible={tab === "paint"} status={status} onAction={refreshStatus} />}
              {value === "games" && <Games visible={tab === "games"} onOpenPaint={() => setTab("paint")} />}
              {value === "gallery" && <Gallery visible={tab === "gallery"} onOpenPaint={() => setTab("paint")} />}
              {value === "ai" && (
                <AiImageDesigner status={aiStatus} visible={tab === "ai"} onOpenPaint={() => setTab("paint")} />
              )}
              {value === "paper" && (
                <Paper status={status} onAction={refreshStatus} visible={tab === "paper"} />
              )}
              {value === "convert" && (
                <Convert status={status} onAction={refreshStatus} visible={tab === "convert"} />
              )}
              {value === "calibrate" && <Calibrate />}
            </div>
          ) : null
        )}
        {tab === "control" && <Control status={status} onAction={refreshStatus} />}
      </main>
    </div>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () =>
    api
      .authSession()
      .then((s) => {
        setSession(s);
        setErr(null);
      })
      .catch((e) => setErr(String(e.message ?? e)));

  useEffect(() => {
    refresh();
  }, []);

  if (err) return <AuthShell><div className="banner err">{err}</div></AuthShell>;
  if (!session) return <AuthShell><p className="muted">{t("common.loading")}</p></AuthShell>;
  if (!session.configured) return <SetupForm onDone={refresh} />;
  if (!session.authenticated) return <LoginForm username={session.username ?? ""} onDone={refresh} />;
  return <>{children}</>;
}

function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="auth-page">
      <section className="card auth-card">
        <h1><span className="pen">✎</span> GCodeScribe</h1>
        {location.protocol === "http:" && !["localhost", "127.0.0.1"].includes(location.hostname) && (
          <div className="banner warn">{t("auth.httpWarning")}</div>
        )}
        {children}
      </section>
    </div>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToasts();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<AuthSetupStart | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = () => {
    setBusy(true);
    setErr(null);
    api.authSetupStart(username, password).then(setSetup).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false));
  };
  const finish = () => {
    if (!setup) return;
    setBusy(true);
    setErr(null);
    api.authSetupFinish(setup.setupId, code).then((r) => setRecovery(r.recoveryCodes)).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false));
  };

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

  if (recovery) {
    return (
      <AuthShell>
        <h2>{t("auth.recoveryTitle")}</h2>
        <p className="muted">{t("auth.recoveryHint")}</p>
        <ul className="recovery-list">{recovery.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
        <button className="primary" onClick={onDone}>{t("common.next")}</button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h2>{t("auth.setupTitle")}</h2>
      <p className="muted">{t("auth.setupHint")}</p>
      {!setup ? (
        <div className="auth-form">
          <label>{t("auth.username")}<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label>{t("auth.password")}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="primary" disabled={busy} onClick={start}>{t("auth.startSetup")}</button>
        </div>
      ) : (
        <div className="auth-form">
          <p className="muted">{t("auth.secretHint")}</p>
          <label>{t("auth.secretLabel")}<input readOnly value={setup.totpSecret} onFocus={(e) => e.currentTarget.select()} /></label>
          <label>{t("auth.otpauthLabel")}<textarea readOnly value={setup.otpauthUri} onFocus={(e) => e.currentTarget.select()} /></label>
          <label>{t("auth.totpCode")}<input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button className="primary" disabled={busy} onClick={finish}>{t("auth.finishSetup")}</button>
        </div>
      )}
    </AuthShell>
  );
}

function LoginForm({ username: initialUsername, onDone }: { username: string; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToasts();
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setBusy(true);
    setErr(null);
    api
      .authLogin(username, password, useRecovery ? "" : code, useRecovery ? code : "")
      .then(onDone)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (err) toast.error(err);
  }, [err, toast]);

  return (
    <AuthShell>
      <h2>{t("auth.loginTitle")}</h2>
      <div className="auth-form">
        <label>{t("auth.username")}<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>{t("auth.password")}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>{useRecovery ? t("auth.recoveryCode") : t("auth.totpCode")}<input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <label className="checkline"><input type="checkbox" checked={useRecovery} onChange={(e) => setUseRecovery(e.target.checked)} />{t("auth.useRecovery")}</label>
        <button className="primary" disabled={busy} onClick={submit}>{t("auth.login")}</button>
      </div>
    </AuthShell>
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
