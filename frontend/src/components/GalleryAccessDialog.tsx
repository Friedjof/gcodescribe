import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "../api";
import { useI18n } from "../i18n";
import Modal from "./Modal";
import { useToasts } from "./Toasts";

function randomSecret(len = 24): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map((b) => chars[b % chars.length])
    .join("");
}

export default function GalleryAccessDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToasts();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [enabled, setEnabled] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .galleryUploadConfig()
      .then((cfg) => {
        setEnabled(cfg.enabled);
        setSecret(cfg.secret);
      })
      .catch(() => toast.error(t("common.loadError")))
      .finally(() => setBusy(false));
  }, []);

  const shareUrl =
    enabled && secret
      ? `${location.origin}/upload?secret=${encodeURIComponent(secret)}`
      : enabled
      ? `${location.origin}/upload`
      : "";

  useEffect(() => {
    if (!canvasRef.current || !shareUrl) return;
    QRCode.toCanvas(canvasRef.current, shareUrl, {
      width: 200,
      margin: 1,
      color: { dark: "#e8e8e8", light: "#1a1a1a" },
    }).catch(() => {});
  }, [shareUrl]);

  const save = () => {
    setSaving(true);
    api
      .patchSettings({ "gallery.upload_enabled": enabled, "gallery.upload_secret": secret })
      .then(() => {
        toast.success(t("settings.saved"));
        onClose();
      })
      .catch((e) => toast.error(String(e.message ?? e)))
      .finally(() => setSaving(false));
  };

  const copyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => toast.success(t("gallery.upload.linkCopied")));
  };

  return (
    <Modal
      title={t("gallery.upload.gateTitle")}
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="primary" disabled={saving || busy} onClick={save}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="gallery-access-dialog">
        {busy ? (
          <p className="muted">{t("common.loading")}</p>
        ) : (
          <>
            <p className="muted">{t("gallery.upload.gateHint")}</p>

            <label className="gallery-access-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>{enabled ? t("gallery.upload.enabledLabel") : t("gallery.upload.disabledLabel")}</span>
            </label>

            <div className="gallery-access-secret">
              <label>
                {t("gallery.upload.secretLabel")}
                <span className="muted gallery-access-secret-hint">
                  {t("gallery.upload.secretHint")}
                </span>
              </label>
              <div className="gallery-access-secret-row">
                <input
                  type="text"
                  value={secret}
                  placeholder={t("gallery.upload.secretPlaceholder")}
                  onChange={(e) => setSecret(e.target.value)}
                  spellCheck={false}
                />
                <button className="ghost" onClick={() => setSecret(randomSecret())}>
                  {t("gallery.upload.generate")}
                </button>
              </div>
            </div>

            {enabled && (
              <div className="gallery-access-share">
                <p className="gallery-access-share-title">{t("gallery.upload.shareTitle")}</p>
                {shareUrl ? (
                  <>
                    <canvas ref={canvasRef} className="gallery-access-qr" />
                    <div className="gallery-access-link-row">
                      <input
                        type="text"
                        readOnly
                        value={shareUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="gallery-access-link"
                      />
                      <button className="ghost" onClick={copyLink}>
                        {t("gallery.upload.copyLink")}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted">{t("gallery.upload.noSecretHint")}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
