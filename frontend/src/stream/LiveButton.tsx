import type { StreamState } from "./protocol";

export default function LiveButton({
  state,
  viewers,
  onClick,
}: {
  state: StreamState;
  viewers: number;
  onClick: () => void;
}) {
  const live = state === "live";
  const label = live ? `Live beenden (${viewers})` : state === "connecting" ? "Live startet…" : "Live auf externem Bildschirm starten";
  return (
    <button className={`live-button ${state}`} onClick={onClick} title={label} aria-label={label}>
      <span className="live-dot" />
      <span>{live ? `Live ${viewers}` : "Live"}</span>
    </button>
  );
}
