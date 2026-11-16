import type { PrinterStatus } from "../../../api";
import { useI18n } from "../../../i18n";
export default function SetupConnectionStep({
  status,
  onSettings,
  onNext,
  onOffline,
}: {
  status: PrinterStatus | null;
  onSettings: () => void;
  onNext: () => void;
  onOffline: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="setup-step-content">
      <h2>{t("setup.connectionTitle")}</h2>
      <p className="setup-lead">{t("setup.connectionIntro")}</p>
      <div
        className={`setup-connection-status ${status?.online ? "connected" : ""}`}
        role="status"
      >
        <strong>
          {t(
            status?.online
              ? "start.connected"
              : status?.configured
                ? "start.connectionOffline"
                : "start.connectionMissing",
          )}
        </strong>
        <p>{t("setup.connectionCheckHint")}</p>
        {status?.error && <p>{status.error}</p>}
      </div>
      <div className="setup-connection-methods">
        <section>
          <h3>USB / Serial</h3>
          <p>{t("setup.usbHint")}</p>
        </section>
        <section>
          <h3>OctoPrint</h3>
          <p>{t("setup.octoHint")}</p>
        </section>
      </div>
      <div className="setup-actions">
        <button className="primary" onClick={onSettings}>
          {t("start.configureConnection")}
        </button>
        {status?.online && (
          <button onClick={onNext}>{t("setup.continueCalibration")}</button>
        )}
      </div>
      {!status?.online && (
        <button className="ghost" onClick={onOffline}>
          {t("setup.prepareOffline")}
        </button>
      )}
      <p className="setup-note">{t("setup.offlineHint")}</p>
    </section>
  );
}
