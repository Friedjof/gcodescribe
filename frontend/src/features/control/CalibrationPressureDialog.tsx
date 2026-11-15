import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Calibration, type CalibrationProfile, type Position } from "../../api";
import Modal from "../../components/Modal";
import { useToasts } from "../../components/Toasts";
import { useI18n } from "../../i18n";
import { useProjectCalibration } from "../../state/ProjectCalibrationContext";
import { isAbortError, errorMessage } from "../../api/errors";

/** Manual insertion height for the supplied project or the active printer profile. */
export default function CalibrationPressureDialog({ canMove, onClose, onBusyChange, onPosition, onCalibration, onAction, projectId, profileId, position: suppliedPosition }: {
  canMove: boolean;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onPosition?: (position: Position) => void;
  onCalibration?: (calibration: Calibration) => void;
  onAction?: () => void;
  projectId?: string;
  profileId?: string;
  position?: Position | null;
}) {
  const { t } = useI18n();
  const toast = useToasts();
  const { profileChanged } = useProjectCalibration();
  const inputId = useId();
  const [profile, setProfile] = useState<CalibrationProfile | null>(null);
  const [localPosition, setPosition] = useState<Position | null>(null);
  const controlledPosition = suppliedPosition !== undefined;
  const position = controlledPosition ? suppliedPosition : localPosition;
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const read = useRef<AbortController | null>(null);
  const changedProfile = useRef<string | null>(null);
  const scope = JSON.stringify([projectId, profileId]);
  const generation = useRef({ scope, value: 0 });
  if (generation.current.scope !== scope)
    generation.current = { scope, value: generation.current.value + 1 };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current.value++; read.current?.abort(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (profileId ? api.getProfile(profileId) : api.activeProfile()).then((current) => {
      if (cancelled) return;
      setProfile(current);
      setOffset(current.calibration.calibration_pressure_offset ?? 0);
    }).catch(error => { if (!cancelled && !isAbortError(error)) toast.error(errorMessage(error)); });
    if (controlledPosition) return () => { cancelled = true; };
    const refresh = () => api.position().then((pos) => { if (!cancelled) setPosition(pos); }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [profileId, controlledPosition]);

  const cal = profile?.calibration;
  const valid = Number.isFinite(offset) && offset >= -3 && offset <= 3;
  const targetZ = cal && valid ? Math.min(cal.z_max, Math.max(0, cal.pen_down_z + offset)) : null;
  const atC = !!cal && !!position?.homed
    && Math.abs(position.x - cal.calibration_x) <= 0.1
    && Math.abs(position.y - cal.calibration_y) <= 0.1;
  const live = useRef({ canMove, position });
  live.current = { canMove, position };
  const run = async (action: (isCurrent: () => boolean) => Promise<void>, motion = false) => {
    if (!mounted.current || pending.current || !profile || (motion && !live.current.canMove)) return;
    const token = generation.current.value;
    const isCurrent = () => mounted.current && generation.current.value === token;
    pending.current = true;
    changedProfile.current = null;
    setBusy(true);
    onBusyChange(true);
    try {
      const controller = new AbortController();
      read.current = controller;
      const current = await (profileId ? api.getProfile(profileId, controller.signal) : api.activeProfile(controller.signal));
      if (!isCurrent() || (motion && !live.current.canMove)) return;
      if (current.id !== profile.id || current.fingerprint !== profile.fingerprint) {
        setProfile(current);
        setOffset(current.calibration.calibration_pressure_offset ?? 0);
        throw new Error(t("paper.pressure.profileChanged"));
      }
      await action(isCurrent);
    } catch (error) {
      if (isCurrent() && !isAbortError(error)) toast.error(errorMessage(error));
    } finally {
      if (changedProfile.current) profileChanged(changedProfile.current);
      read.current = null;
      pending.current = false;
      if (mounted.current) setBusy(false);
      onBusyChange(false);
    }
  };
  const save = async (isCurrent: () => boolean) => {
    if (!isCurrent()) return null;
    const updated = await api.saveProfile(profile!.id, { calibration: { calibration_pressure_offset: offset } });
    changedProfile.current = updated.id;
    if (isCurrent()) { setProfile(updated); onCalibration?.(updated.calibration); }
    return updated;
  };
  const moved = (pos: Position) => {
    setPosition(pos);
    onPosition?.(pos);
    onAction?.();
  };
  return createPortal(
    <Modal title={t("paper.pressure.title")} className="calibration-pressure-dialog"
      onClose={() => { if (!pending.current) onClose(); }}
      footer={<>
        <button disabled={!profile || !valid || busy} onClick={() => run(async isCurrent => {
          await save(isCurrent);
          if (isCurrent()) toast.success(t("paper.pressure.saved"));
        })}>{t("common.save")}</button>
        <button className="primary" disabled={!canMove || !atC || !valid || busy} onClick={() => run(async isCurrent => {
          const updated = await save(isCurrent);
          if (!updated || !isCurrent() || !live.current.canMove) return;
          const head = live.current.position;
          if (!head?.homed || Math.abs(head.x - updated.calibration.calibration_x) > 0.1
              || Math.abs(head.y - updated.calibration.calibration_y) > 0.1) return;
          const result = await (projectId
            ? api.calibrationHeight(profile!.id, offset, projectId)
            : api.calibrationHeight(profile!.id, offset));
          if (isCurrent()) moved(result.position);
        }, true)}>{t("paper.pressure.apply")}</button>
      </>}>
      {!cal ? <p>{t("common.loading")}</p> : <>
        <p className="muted">{t("paper.activeProfile", { name: profile!.name })}</p>
        <p>{t("paper.pressure.hint")}</p>
        <label className="pressure-value" htmlFor={inputId}>
          <span>{t("paper.pressure.offset")}</span>
          <input id={inputId} type="number" min={-3} max={3} step={0.1} value={Number.isFinite(offset) ? offset : ""}
            disabled={busy} onChange={(event) => setOffset(event.target.valueAsNumber)} />
          <span>mm</span>
        </label>
        <input className="pressure-slider" type="range" min={-3} max={3} step={0.1}
          aria-label={t("paper.pressure.offset")} value={valid ? offset : 0} disabled={busy}
          onChange={(event) => setOffset(event.target.valueAsNumber)} />
        <div className="pressure-scale"><span>−3 · {t("paper.pressure.less")}</span><span>+3 · {t("paper.pressure.more")}</span></div>
        <p className="pressure-height">{t("paper.pressure.height", { z: targetZ?.toFixed(2) ?? "—" })}</p>
        <p className="muted">{t("paper.currentZ")}: {position?.homed ? `${position.z.toFixed(2)} mm` : "—"}</p>
        <p className="muted">{t("paper.pressure.manual")}</p>
        {!atC && <div className="pressure-goto">
          <span className="muted">{t("paper.pressure.needC")}</span>
          <button disabled={!canMove || busy} title={t("paper.positions.homeHint", { marker: "C" })}
            onClick={() => run(async isCurrent => {
              const result = await (projectId ? api.homeAndMoveToPosition("calibration", projectId)
                : api.homeAndMoveToPosition("calibration"));
              if (isCurrent()) moved(result.position);
            }, true)}>
            {t("paper.positions.homeVisit", { marker: "C" })}
          </button>
        </div>}
      </>}
    </Modal>, document.body,
  );
}
