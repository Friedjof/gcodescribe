import type { SceneObject } from "../../../api";
import { useI18n } from "../../../i18n";
import type { ObjectOps } from "../hooks/useObjectOps";

/** Right-click context menu on canvas objects (mask stamp, group, ungroup). */
export default function PaintObjectMenu({
  menu,
  objects,
  ops,
  onClose,
}: {
  menu: { x: number; y: number; ids: string[] } | null;
  objects: SceneObject[];
  ops: Pick<ObjectOps, "applyMaskStamp" | "groupSelected" | "ungroupSelected">;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!menu) return null;
  const canUngroup = objects.some((obj) => menu.ids.includes(obj.id) && obj.groupId);
  const maskId = menu.ids.length === 1
    ? objects.find((o) => o.id === menu.ids[0] && (o.type === "mask" || o.data?.mask === "erase"))?.id ?? null
    : null;
  return (
    <div className="paint-context-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
      {maskId && (
        <button onClick={() => { ops.applyMaskStamp(maskId); onClose(); }}>{t("paint.applyMask")}</button>
      )}
      <button disabled={menu.ids.length < 2} onClick={() => { ops.groupSelected(menu.ids); onClose(); }}>{t("paint.group")}</button>
      <button disabled={!canUngroup} onClick={() => { ops.ungroupSelected(menu.ids); onClose(); }}>{t("paint.ungroup")}</button>
    </div>
  );
}
