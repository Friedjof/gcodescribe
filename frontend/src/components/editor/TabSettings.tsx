import { useRef } from "react";
import Modal from "../Modal";
import { useI18n } from "../../i18n";
import { useInterface } from "../../interface/InterfaceProvider";
import { workspaceAvailable, workspaceById, type WorkspaceId } from "../../interface/workspaces";
import EditorIcon from "./EditorIcon";

export default function TabSettings({ aiEnabled, onClose, onOpen }: { aiEnabled: boolean; onClose: () => void; onOpen: (id: WorkspaceId) => void }) {
  const { t } = useI18n();
  const { preferences, update, resetTabs } = useInterface();
  const drag = useRef<WorkspaceId | null>(null);
  const availableVisible = preferences.visibleWorkspaces.filter(id => workspaceAvailable(workspaceById(id), aiEnabled));
  const toggle = (id: WorkspaceId, checked: boolean) => update(prefs => ({ ...prefs,
    visibleWorkspaces: checked ? [...new Set([...prefs.visibleWorkspaces, id])] : prefs.visibleWorkspaces.filter(item => item !== id) }));
  const move = (id: WorkspaceId, target: number) => update(prefs => {
    const order = prefs.workspaceOrder.filter(item => item !== id);
    order.splice(Math.max(0, Math.min(target, order.length)), 0, id);
    return { ...prefs, workspaceOrder: order };
  });
  return <Modal title={t("interface.customizeTabs")} onClose={onClose} className="tab-settings-dialog"
    footer={<><button onClick={() => resetTabs()}>{t("interface.resetTabs")}</button><button onClick={() => resetTabs(true)}>{t("interface.allAreas")}</button>
      <button className="primary" onClick={onClose}>{t("common.close")}</button></>}>
    <p className="dialog-intro">{t("interface.tabsHelp")}</p>
    <ul className="tab-settings-list">
      {preferences.workspaceOrder.map((id, index) => {
        const workspace = workspaceById(id), available = workspaceAvailable(workspace, aiEnabled);
        const checked = preferences.visibleWorkspaces.includes(id);
        return <li key={id} draggable={available} onDragStart={event => { drag.current = id; event.dataTransfer.setData("text/plain", id); }}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (drag.current) move(drag.current, index); drag.current = null; }}>
          <label><input type="checkbox" checked={checked} disabled={!available || checked && availableVisible.length <= 1}
            onChange={event => toggle(id, event.target.checked)} /><span><strong>{t(workspace.label)}</strong><small>{available ? t(workspace.description) : t("interface.unavailable")}</small></span></label>
          <div className="tab-order-actions">
            <button className="icon-button" disabled={index === 0} onClick={() => move(id, index - 1)} aria-label={t("interface.moveTabUp", { name: t(workspace.label) })}><EditorIcon name="up" size={16} /></button>
            <button className="icon-button" disabled={index === preferences.workspaceOrder.length - 1} onClick={() => move(id, index + 1)} aria-label={t("interface.moveTabDown", { name: t(workspace.label) })}><EditorIcon name="down" size={16} /></button>
            <button disabled={!available} onClick={() => { toggle(id, true); onOpen(id); onClose(); }}>{t("interface.openArea")}</button>
          </div>
        </li>;
      })}
    </ul>
  </Modal>;
}
