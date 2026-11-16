import TourProvider from "./features/tour/TourProvider";
import { isPrinterBusy } from "./lib/printerState";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { PrinterStatus } from "./api/types/printer";
import { api, onAppEvent, type AiImageStatus, type EffectiveSettings } from "./api";
import StatusPill from "./components/StatusPill";
import { usePlotNotifications } from "./hooks/usePlotNotifications";
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
import WorkspaceTabs from "./components/editor/WorkspaceTabs";
import TabSettings from "./components/editor/TabSettings";
import ProgramMenus from "./components/editor/ProgramMenus";
import type { PaintWorkspaceCommand } from "./interface/commands";
const PaintInfoModal = lazy(() => import("./features/paint/components/PaintInfoModal"));
import EditorIcon from "./components/editor/EditorIcon";
import { SetupProgressProvider } from "./features/start/setup/SetupProgressProvider";
import { InterfaceProvider, useInterface } from "./interface/InterfaceProvider";
import { WORKSPACES, visibleWorkspaces, usableWorkspace, workspaceById, type WorkspaceId } from "./interface/workspaces";
const SetupWorkspace = lazy(() => import("./features/start/SetupWorkspace"));
const SettingsDialog = lazy(() => import("./features/settings/SettingsDialog"));
import { useToasts } from "./components/Toasts";
import { useI18n } from "./i18n";

import BackgroundTasks from "./components/BackgroundTasks";
import DelayedLoading from "./components/DelayedLoading";
import { ProjectCalibrationProvider } from "./state/ProjectCalibrationContext";

import { installPageEditLifecycle } from "./api/pageEdits";

type Tab = WorkspaceId;

export default function App() {
  useEffect(installPageEditLifecycle, []);
  return (
    <InterfaceProvider><AuthGate>
      <AdminApp />
    </AuthGate></InterfaceProvider>
  );
}

// Heavy, stateful tabs: mount once on first visit and keep them alive (hidden)
// so switching back is instant instead of refetching + rebuilding the canvas.
// The lighter list/state tabs stay unmount-on-switch so they reflect fresh data.
const KEEP_ALIVE = WORKSPACES.filter(workspace => workspace.keepAlive).map(workspace => workspace.id);

function AdminApp() {
  const { lang, setLang, t } = useI18n();
  const toast = useToasts();
  const [galleryResult, setGalleryResult] = useState<string>();
  const { preferences, update } = useInterface();
  const [tourWorkspace, setTourWorkspace] = useState<Tab | null>(null);
  const [requestedTab, setRequestedTab] = useState<Tab>("paper");
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paintCommand, setPaintCommand] = useState<PaintWorkspaceCommand | null>(null);
  const commandId = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(["paper"]));
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AiImageStatus | null>(null);
  const [aiInitialFile, setAiInitialFile] = useState<File | null>(null);
  const [desktop, setDesktop] = useState(false);
  const visibleTabs = tourWorkspace && !preferences.visibleWorkspaces.includes(tourWorkspace) ? [...preferences.visibleWorkspaces, tourWorkspace] : preferences.visibleWorkspaces;
  const tab = usableWorkspace(requestedTab, preferences.workspaceOrder, visibleTabs, aiStatus?.enabled ?? false);
  const workspaces = visibleWorkspaces(preferences.workspaceOrder, visibleTabs, aiStatus?.enabled ?? false);
  const interactive = !settingsOpen && !tabSettingsOpen && !helpOpen;
  const setTab = useCallback((id: Tab) => {
    if (id === "start") id = "paper";
    if (id === "ai" && !aiStatus?.enabled) return;
    update(prefs => prefs.visibleWorkspaces.includes(id) ? prefs : { ...prefs, visibleWorkspaces: [...prefs.visibleWorkspaces, id] });
    setRequestedTab(id);
  }, [aiStatus?.enabled, update]);
  const navigateTour = useCallback((id: Tab) => { setTourWorkspace(id); setRequestedTab(id); }, []);
  const endTour = useCallback(() => setTourWorkspace(null), []);
  const openPaint = useCallback(() => setTab("paint"), [setTab]);
  useEffect(() => { if (tab !== requestedTab) setRequestedTab(tab); }, [tab, requestedTab]);
  const notifications = usePlotNotifications(status);
  const notificationPermission = notifications.permission;

  useEffect(() => {
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);

  // Checked once after login — server-gated flags.
  useEffect(() => {
    api.aiImageStatus().then(setAiStatus).catch(() => setAiStatus(null));
    api.health().then((h) => setDesktop(h.desktop)).catch(() => {});
  }, []);

  const notificationsActive = notifications.active;
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

  return (
    <SetupProgressProvider>
    <ProjectCalibrationProvider active={tab === "paint" || tab === "paper" || tab === "games"}>
    <TourProvider activeWorkspace={tab} onNavigate={navigateTour} onEnd={endTour} blocked={!interactive} printerBusy={isPrinterBusy(status)}>
    <div className={`app tab-${tab}`}>
      <header className="app-titlebar">
        <h1 className="app-brand"><EditorIcon name="draw" size={20} />GCodeScribe</h1>
        <div className="app-main-menu">
          <ProgramMenus aiEnabled={aiStatus?.enabled ?? false} onNavigate={setTab} onSettings={() => setSettingsOpen(true)} onCustomize={() => setTabSettingsOpen(true)} onHelp={() => setHelpOpen(true)}
            onProjects={() => { setPaintCommand({ id: ++commandId.current, type: "projects" }); setTab("paint"); }}
            onNewPage={() => { setPaintCommand({ id: ++commandId.current, type: "new-page" }); setTab("paint"); }}
            notifications={{ supported: notificationPermission !== "unsupported", granted: notificationPermission === "granted", action: notificationPermission === "granted" ? notifications.test : notifications.request }} />
        </div>
        <div className="header-actions">
          <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value as "de" | "ba" | "en" | "fr" | "es")}>
            <option value="de">{t("lang.de")}</option>
            <option value="ba">{t("lang.ba")}</option>
            <option value="en">{t("lang.en")}</option>
            <option value="fr">{t("lang.fr")}</option>
            <option value="es">{t("lang.es")}</option>
          </select>
          <button className="app-connection-button" title={t("start.configureConnection")} aria-label={t("start.configureConnection")} onClick={() => setSettingsOpen(true)}><StatusPill status={status} /></button>
          {canStopPlot(status) && <QuickStopPlot status={status} onAction={refreshStatus} />}
        </div>
      </header>
      <WorkspaceTabs workspaces={workspaces} active={tab} onChange={setTab} onCustomize={() => setTabSettingsOpen(true)} />
      {tabSettingsOpen && <TabSettings aiEnabled={aiStatus?.enabled ?? false} onClose={() => setTabSettingsOpen(false)} onOpen={setTab} />}

      <Suspense fallback={<DelayedLoading />}>
      {helpOpen && <PaintInfoModal onClose={() => setHelpOpen(false)} />}
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
            <div key={value} role="tabpanel" id={`workspace-panel-${value}`} aria-labelledby={`workspace-tab-${value}`} hidden={tab !== value} style={{ display: tab === value ? "contents" : "none" }}>
              <Suspense fallback={<DelayedLoading />}>
              {value === "paint" && <Paint command={paintCommand} onCommandHandled={() => setPaintCommand(null)} visible={tab === "paint" && interactive} status={status} onAction={refreshStatus} desktop={desktop} />}
              {value === "games" && <Games visible={tab === "games" && interactive} onOpenPaint={openPaint} desktop={desktop} />}
              {value === "gallery" && <Gallery initialItemId={galleryResult} visible={tab === "gallery" && interactive} onOpenPaint={openPaint} onOpenAiDesigner={aiStatus?.enabled ? openInAiDesigner : undefined} aiEnabled={aiStatus?.enabled ?? false} desktop={desktop} />}
              {value === "ai" && (
                <AiImageDesigner status={aiStatus} visible={tab === "ai" && interactive} onOpenPaint={openPaint} initialFile={aiInitialFile} />
              )}
              {value === "paper" && (
                <SetupWorkspace visible={tab === "paper" && interactive} onAction={refreshStatus} status={status} onNavigate={setTab} onSettings={() => setSettingsOpen(true)} />
              )}
              {value === "convert" && (
                <Convert status={status} onAction={refreshStatus} visible={tab === "convert" && interactive} />
              )}
              {value === "calibrate" && <Calibrate />}
              {value === "font" && <FontEditor visible={tab === "font" && interactive} />}
              </Suspense>
            </div>
          ) : null
        )}
        {tab === "control" && <div role="tabpanel" id="workspace-panel-control" aria-labelledby="workspace-tab-control"><Suspense fallback={<DelayedLoading />}><Control status={status} onAction={refreshStatus} onSettings={() => setSettingsOpen(true)} /></Suspense></div>}
      </main>
      <footer className="app-statusbar"><span>{t(workspaceById(tab).label)}</span><span>{t(preferences.experience === "guided" ? "interface.guided" : "interface.full")} · {t(preferences.density === "compact" ? "interface.compact" : "interface.comfortable")}</span></footer>
    </div>
    </TourProvider>
    </ProjectCalibrationProvider>
    </SetupProgressProvider>
  );
}
