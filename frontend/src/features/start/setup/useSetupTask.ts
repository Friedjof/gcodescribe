import { useEffect, useRef, useState } from "react";
import { errorMessage, isAbortError } from "../../../api/errors";
/** One explicit setup command at a time; late results cannot advance a different project. */
export function useSetupTask(scope: string, active: boolean) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    pending = useRef(false);
  const current = useRef({ scope, active, generation: 0 });
  if (current.current.scope !== scope || current.current.active !== active) {
    current.current = {
      scope,
      active,
      generation: current.current.generation + 1,
    };
  }
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => setError(null), [scope]);
  const run = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (pending.current || !active) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const generation = current.current.generation;
    const isCurrent = () =>
      mounted.current &&
      current.current.generation === generation &&
      current.current.scope === scope &&
      current.current.active;
    try {
      await action(isCurrent);
    } catch (error) {
      if (isCurrent() && !isAbortError(error)) setError(errorMessage(error));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, error, run };
}
