import { useRef } from "react";
import { useI18n } from "../../i18n";
import type { WorkspaceDefinition, WorkspaceId } from "../../interface/workspaces";
import EditorIcon from "./EditorIcon";

export default function WorkspaceTabs({ workspaces, active, onChange, onCustomize }: {
  workspaces: readonly WorkspaceDefinition[]; active: WorkspaceId;
  onChange: (id: WorkspaceId) => void; onCustomize: () => void;
}) {
  const { t } = useI18n();
  const refs = useRef(new Map<WorkspaceId, HTMLButtonElement>());
  const navigate = (event: React.KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % workspaces.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + workspaces.length) % workspaces.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = workspaces.length - 1;
    else return;
    event.preventDefault();
    const workspace = workspaces[next];
    onChange(workspace.id); refs.current.get(workspace.id)?.focus();
  };
  return <div className="workspace-tabs-row">
    <nav className="workspace-tabs" role="tablist" aria-label={t("interface.workspaces")}>
      {workspaces.map((workspace, index) => <button key={workspace.id} type="button" role="tab"
        id={`workspace-tab-${workspace.id}`} aria-controls={`workspace-panel-${workspace.id}`}
        aria-selected={workspace.id === active} tabIndex={workspace.id === active ? 0 : -1}
        ref={node => { if (node) refs.current.set(workspace.id, node); else refs.current.delete(workspace.id); }}
        onKeyDown={event => navigate(event, index)} onClick={() => onChange(workspace.id)}
        title={t(workspace.description)}>{t(workspace.label)}</button>)}
    </nav>
    <button className="workspace-customize" type="button" onClick={onCustomize} title={t("interface.customizeTabs")}
      aria-label={t("interface.customizeTabs")}><EditorIcon name="tabs" size={17} /><span>{t("interface.moreAreas")}</span></button>
  </div>;
}
