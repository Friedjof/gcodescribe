import { useEffect, useRef, useState } from "react";

interface CommandSession {
  isCurrent: () => boolean;
  canMove: () => boolean;
  sameCalibration: () => boolean;
}
interface Options { motion?: boolean; needsHome?: boolean }

/** Serialize user commands and invalidate continuations when their view changes. */
export function useCalibrationCommands(input: {
  scope: string; visible: boolean; ready: boolean; motionAllowed: boolean; homed: boolean;
  fingerprint?: string; onError: (error: unknown) => void; onAction: () => void;
}) {
  const current = useRef(input);
  const generation = useRef(0);
  if (current.current.scope !== input.scope || current.current.visible !== input.visible) generation.current++;
  current.current = input;
  const mounted = useRef(false);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);

  const run = async (action: (session: CommandSession) => Promise<void | false>, options: Options = {}): Promise<boolean> => {
    const start = current.current;
    if (!mounted.current || input.scope !== start.scope || !start.visible || !start.ready || pending.current
        || (options.motion && !start.motionAllowed) || (options.needsHome && !start.homed)) return false;
    const token = generation.current;
    const isCurrent = () => mounted.current && current.current.visible && generation.current === token;
    const session = {
      isCurrent,
      canMove: () => isCurrent() && current.current.ready && current.current.motionAllowed
        && (!options.needsHome || current.current.homed),
      sameCalibration: () => isCurrent() && start.fingerprint === current.current.fingerprint,
    };
    pending.current = true;
    setBusy(true);
    try {
      const result = await action(session);
      if (!isCurrent() || result === false) return false;
      current.current.onAction();
      return true;
    } catch (error) {
      if (isCurrent()) current.current.onError(error);
      return false;
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { run, busy };
}
