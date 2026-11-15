import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, onAppEvent, type AiImageStatus, type EffectiveSettings } from "./api";
import StatusPill from "./components/StatusPill";
import QuickStopPlot, { canStopPlot } from "./components/QuickStopPlot";
const AiImageDesigner = lazy(() => import("./features/ai-designer/AiImageDesigner"));
import AuthGate from "./features/auth/AuthGate";
const Convert = lazy(() => import("./features/convert/Convert"));
const Paint = lazy(() => import("./features/paint/Paint"));
const FontEditor = lazy(() => import("./features/font-editor/components/FontEditor"));
const Games = lazy(() => import("./features/games/Games"));
const Gallery = lazy(() => import("./features/gallery/Gallery"));
const Calibrate = lazy(() => import("./features/control/Calibrate"));
const Control = lazy(() => import("./features/control/Control"));
const Paper = lazy(() => import("./features/control/Paper"));
import Segmented from "./components/Segmented";
const SettingsDialog = lazy(() => import("./features/settings/SettingsDialog"));
import { useToasts } from "./components/Toasts";
import { useI18n } from "./i18n";

import BackgroundTasks from "./components/BackgroundTasks";
import DelayedLoading from "./components/DelayedLoading";

type Tab = "paint" | "games" | "gallery" | "ai" | "convert" | "paper" | "calibrate" | "control" | "font";

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
const KEEP_ALIVE: Tab[] = ["paint", "games", "gallery", "ai", "convert", "paper", "calibrate", "font"];
const PLOT_PROGRESS_THRESHOLDS = [25, 50, 90, 100];

function AdminApp() {
  const { lang, setLang, t } = useI18n();
  const toast = useToasts();
  const [galleryResult, setGalleryResult] = useState<string>();
  const [tab, setTab] = useState<Tab>("paint");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(["paint"]));
  const [status, setStatus] = useState<any>(null);
  const [aiStatus, setAiStatus] = useState<AiImageStatus | null>(null);
  const [aiInitialFile, setAiInitialFile] = useState<File | null>(null);
  const [desktop, setDesktop] = useState(false);
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

  // Checked once after login — server-gated flags.
  useEffect(() => {
    api.aiImageStatus().then(setAiStatus).catch(() => setAiStatus(null));
    api.health().then((h) => setDesktop(h.desktop)).catch(() => {});
  }, []);

  const notificationsActive = notificationPermission === "granted";
  const refreshStatus = useCallback(() => api.octoStatus().then(setStatus).catch(() => setStatus(null)), []);

  // Surface a toast whenever a connected agent triggers an MCP tool. The data
  // those tools change is refreshed live by each view (e.g. the designer) via
  // the same event stream.
  useEffect(() => {
    return onAppEvent((event) => {
      if (event.type !== "mcp") return;
      const message = t("mcp.toolUsed", { tool: event.tool });
      if (event.ok) toast.notify(message, { kind: "ok" });
      else toast.warn(t("mcp.toolFailed", { tool: event.tool }));
    });
  }, [t, toast]);

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
      const name = key.replace(/\.[^/.]+$/, "");
      const message = pct >= 100
        ? t("notify.plotDone", { name })
        : t("notify.plotProgress", { pct, name });
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

  const openInAiDesigner = (itemId: string) => {
    api.galleryOriginal(itemId)
      .then((blob) => {
        const ext = blob.type.includes("png") ? "png" : "jpg";
        const file = new File([blob], `gallery-${itemId}.${ext}`, { type: blob.type });
        setAiInitialFile(file);
        setVisited((prev) => (prev.has("ai") ? prev : new Set(prev).add("ai")));
        setTab("ai");
      })
      .catch(() => {});
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: "paint", label: t("tabs.paint") },
    ...(aiStatus?.enabled ? [{ value: "ai" as Tab, label: t("tabs.ai") }] : []),
    { value: "games", label: t("tabs.games") },
    { value: "font", label: t("tabs.fontEditor") },
    { value: "gallery", label: t("tabs.gallery") },
    { value: "convert", label: t("tabs.jobs") },
    { value: "calibrate", label: t("tabs.calibrate") },
    { value: "paper", label: t("tabs.paper") },
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
          {canStopPlot(status) && <QuickStopPlot status={status} onAction={refreshStatus} />}
        </div>
      </header>

      <nav className="tabs-nav">
        <Segmented<Tab> className="nav" value={tab} onChange={setTab} options={tabs} />
      </nav>

      <Suspense fallback={<DelayedLoading />}>
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(saved: EffectiveSettings) => {
            void refreshStatus();
            if (saved.ai.enabled && !aiStatus?.enabled) {
              api.aiImageStatus().then((s) => {
                setAiStatus(s);
                if (s.enabled) {
                  setSettingsOpen(false);
                  setTab("ai");
                }
              }).catch(() => {});
            }
          }}
        />
      )}

      </Suspense>
      <BackgroundTasks onOpenResult={(id) => { setGalleryResult(id); setTab("gallery"); }} />
      <main>
        {/* Kept alive: rendered once visited, hidden (not unmounted) when inactive.
            `display: contents` keeps the layout/height chain identical to before. */}
        {KEEP_ALIVE.map((value) =>
          visited.has(value) ? (
            <div key={value} style={{ display: tab === value ? "contents" : "none" }}>
              <Suspense fallback={<DelayedLoading />}>
              {value === "paint" && <Paint visible={tab === "paint"} status={status} onAction={refreshStatus} desktop={desktop} />}
              {value === "games" && <Games visible={tab === "games"} onOpenPaint={() => setTab("paint")} desktop={desktop} />}
              {value === "gallery" && <Gallery initialItemId={galleryResult} visible={tab === "gallery"} onOpenPaint={() => setTab("paint")} onOpenAiDesigner={aiStatus?.enabled ? openInAiDesigner : undefined} aiEnabled={aiStatus?.enabled ?? false} desktop={desktop} />}
              {value === "ai" && (
                <AiImageDesigner status={aiStatus} visible={tab === "ai"} onOpenPaint={() => setTab("paint")} initialFile={aiInitialFile} />
              )}
              {value === "paper" && (
                <Paper status={status} onAction={refreshStatus} visible={tab === "paper"} />
              )}
              {value === "convert" && (
                <Convert status={status} onAction={refreshStatus} visible={tab === "convert"} />
              )}
              {value === "calibrate" && <Calibrate />}
              {value === "font" && <FontEditor visible={tab === "font"} />}
              </Suspense>
            </div>
          ) : null
        )}
        {tab === "control" && <Suspense fallback={<DelayedLoading />}><Control status={status} onAction={refreshStatus} /></Suspense>}
      </main>
    </div>
  );
}
