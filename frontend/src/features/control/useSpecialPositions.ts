import { useEffect, useRef, useState } from "react";
import { api, type Calibration, type Position, type PositionKind } from "../../api";
import { useI18n } from "../../i18n";
import { positionDefinition, type PositionTarget } from "./specialPositions";

export function useSpecialPositions({ active, cal, pos, profileId, projectId, canMove, onPosition, onCalibration, execute }: {
  active: boolean;
  cal: Calibration | null;
  pos: Position | null;
  profileId: string | null;
  projectId?: string;
  canMove: boolean;
  onPosition: (position: Position) => void;
  onCalibration: (calibration: Calibration) => void;
  execute: (action: () => Promise<void>, homesFirst: boolean) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<PositionKind>("park");
  const [target, setTarget] = useState<PositionTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const generation = useRef(0);
  const available = active && canMove && !!cal && !!profileId;
  const ready = available && !!pos?.homed;

  useEffect(() => {
    generation.current++;
    setTarget(null);
    setMessage("");
    return () => { generation.current++; };
  }, [active, profileId, projectId, kind]);

  const run = async (action: () => Promise<void>, homesFirst = false) => {
    if (!(homesFirst ? available : ready) || pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    const token = generation.current;
    try {
      const ok = await execute(action, homesFirst);
      if (!ok && token === generation.current) setTarget(null);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const move = (xy: { x: number; y: number }) => run(async () => {
    const token = generation.current;
    setTarget({ kind, ...xy });
    const result = await (projectId ? api.moveToPosition(kind, xy, projectId) : api.moveToPosition(kind, xy));
    if (token === generation.current) {
      onPosition(result.position);
      setTarget({ kind, x: result.position.x, y: result.position.y });
      setMessage(t("paper.positions.commandSent"));
    }
  });

  const capture = () => run(async () => {
    const token = generation.current;
    const updated = await (projectId ? api.positionFromHead(kind, projectId) : api.positionFromHead(kind));
    if (token !== generation.current) return;
    onCalibration(updated);
    setTarget(null);
    setMessage(t("paper.positions.saved", { marker: positionDefinition(kind).marker }));
  });

  const homeAndVisit = () => run(async () => {
    const token = generation.current;
    setTarget(null);
    const result = await (projectId ? api.homeAndMoveToPosition(kind, projectId) : api.homeAndMoveToPosition(kind));
    if (token === generation.current) {
      onPosition(result.position);
      setMessage(t("paper.positions.commandSent"));
    }
  }, true);

  return {
    kind, target: active ? target : null, busy, ready, available, message,
    select: (next: PositionKind) => { if (!pending.current) setKind(next); },
    move, capture, homeAndVisit,
  };
}
