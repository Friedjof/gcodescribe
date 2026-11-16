import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type {
  WorkspaceDefinition,
  WorkspaceId,
} from "../../interface/workspaces";
import { fitWorkspaceTabs } from "../../interface/tabOverflow";
import EditorMenu from "./EditorMenu";
import EditorIcon from "./EditorIcon";

export default function WorkspaceTabs({
  workspaces,
  active,
  onChange,
  onCustomize,
}: {
  workspaces: readonly WorkspaceDefinition[];
  active: WorkspaceId;
  onChange: (id: WorkspaceId) => void;
  onCustomize: () => void;
}) {
  const { t } = useI18n();
  const refs = useRef(new Map<WorkspaceId, HTMLButtonElement>());
  const strip = useRef<HTMLDivElement>(null),
    measures = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<WorkspaceId[]>(
    workspaces.map((workspace) => workspace.id),
  );
  useLayoutEffect(() => {
    const measure = () => {
      const spans =
        measures.current?.querySelectorAll<HTMLElement>("[data-tab-measure]");
      if (!strip.current || !spans) return;
      const widths = Array.from(spans).map(
        (span) => span.getBoundingClientRect().width + 2,
      );
      const overflowWidth =
        measures.current
          ?.querySelector<HTMLElement>(".workspace-overflow-measure")
          ?.getBoundingClientRect().width ?? 85;
      const next = fitWorkspaceTabs(
        workspaces.map((workspace) => workspace.id),
        widths,
        Math.max(0, strip.current.clientWidth - 16),
        overflowWidth + 4,
        active,
      );
      setShown((previous) =>
        previous.join() === next.join() ? previous : next,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (strip.current) observer?.observe(strip.current);
    return () => observer?.disconnect();
  }, [workspaces, active, t]);
  const displayed = workspaces.filter((workspace) =>
    shown.includes(workspace.id),
  );
  const overflow = workspaces.filter(
    (workspace) => !shown.includes(workspace.id),
  );
  const navigate = (event: React.KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % displayed.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + displayed.length) % displayed.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = displayed.length - 1;
    else return;
    event.preventDefault();
    const workspace = displayed[next];
    onChange(workspace.id);
    refs.current.get(workspace.id)?.focus();
  };
  return (
    <div className="workspace-tabs-row">
      <div className="workspace-tabs-strip" ref={strip}>
        <nav
          className="workspace-tabs"
          role="tablist"
          aria-label={t("interface.workspaces")}
        >
          {displayed.map((workspace, index) => (
            <button
              key={workspace.id}
              type="button"
              role="tab"
              id={`workspace-tab-${workspace.id}`}
              aria-controls={`workspace-panel-${workspace.id}`}
              aria-selected={workspace.id === active}
              tabIndex={workspace.id === active ? 0 : -1}
              ref={(node) => {
                if (node) refs.current.set(workspace.id, node);
                else refs.current.delete(workspace.id);
              }}
              onKeyDown={(event) => navigate(event, index)}
              onClick={() => onChange(workspace.id)}
              title={t(workspace.description)}
            >
              {t(workspace.label)}
            </button>
          ))}
        </nav>
        {overflow.length > 0 && (
          <EditorMenu
            className="workspace-overflow-trigger"
            label={t("interface.moreTabs")}
            items={overflow.map((workspace) => ({
              id: workspace.id,
              label: t(workspace.label),
              action: () => { onChange(workspace.id); requestAnimationFrame(() => refs.current.get(workspace.id)?.focus()); },
            }))}
          />
        )}
        <div
          className="workspace-tabs-measure"
          ref={measures}
          aria-hidden="true"
        >
          {workspaces.map((workspace) => (
            <span key={workspace.id} data-tab-measure>
              {t(workspace.label)}
            </span>
          ))}
          <span className="workspace-overflow-measure">
            {t("interface.moreTabs")} ▾
          </span>
        </div>
      </div>
      <button
        data-tour="workspace-settings" className="workspace-customize"
        type="button"
        onClick={onCustomize}
        title={t("interface.customizeTabs")}
        aria-label={t("interface.customizeTabs")}
      >
        <EditorIcon name="tabs" size={17} />
        <span>{t("interface.moreAreas")}</span>
      </button>
    </div>
  );
}
