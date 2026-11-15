import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useToasts } from "../components/Toasts";
import { newPlotTracker, plotNotices } from "./plotProgress";

type Permission = NotificationPermission | "unsupported";
function permissionNow(): Permission {
  if (typeof Notification === "undefined" || window.isSecureContext === false) return "unsupported";
  return Notification.permission;
}

export function usePlotNotifications(status: any) {
  const { t } = useI18n();
  const toast = useToasts();
  const [permission, setPermission] = useState<Permission>(permissionNow);
  const tracker = useRef(newPlotTracker());
  const refresh = () => setPermission(permissionNow());

  useEffect(() => {
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const show = (message: string, tag: string) => {
    if (permissionNow() !== "granted") { refresh(); return false; }
    try {
      const notification = new Notification(t("notify.title"), { body: message, tag });
      notification.onclick = () => { window.focus(); notification.close(); };
      return true;
    } catch {
      refresh();
      toast.warn(t("notify.failed"));
      return false;
    }
  };
  const test = () => {
    if (show(t("notify.testBody"), "gcodescribe-test")) toast.success(t("notify.testSent"));
  };
  const request = async () => {
    if (permissionNow() === "unsupported") {
      setPermission("unsupported");
      toast.warn(t(window.isSecureContext === false ? "notify.secureRequired" : "notify.unsupported"));
      return;
    }
    try {
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next === "granted") test();
      else toast.warn(t("notify.denied"));
    } catch {
      refresh();
      toast.warn(t("notify.failed"));
    }
  };

  useEffect(() => {
    for (const notice of plotNotices(tracker.current, status)) {
      const name = notice.filename.replace(/\.[^/.]+$/, "");
      const message = t(notice.pct === 100 ? "notify.plotDone" : "notify.plotProgress", { name, pct: notice.pct });
      toast.success(message);
      if (permission === "granted") show(message, `gcodescribe-plot-${notice.filename}`);
    }
  }, [permission, status, t, toast]);

  return { permission, active: permission === "granted", request, test };
}
