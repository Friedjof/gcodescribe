import type { StreamState } from "./protocol";
import { useI18n } from "../i18n";

export default function LiveButton({
  state,
  viewers,
  onClick,
}: {
  state: StreamState;
  viewers: number;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const live = state === "live";
  const label = live
    ? t("live.button.stop", { viewers })
    : state === "connecting"
      ? t("live.button.starting")
      : t("live.button.startSecondScreen");
  return (
    <button className={`live-button ${state}`} onClick={onClick} title={label} aria-label={label}>
      <span className="live-dot" />
      <span>{live ? `Live ${viewers}` : "Live"}</span>
    </button>
  );
}
