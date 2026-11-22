import { useEffect, useState } from "react";
import { useAssetTasks, watchAssetTasks, taskAction, dismissAllTasks } from "../api/assetTasks";
import { useI18n } from "../i18n";
import { useToasts } from "./Toasts";

export default function BackgroundTasks({ onOpenResult }: { onOpenResult: (id: string) => void }) {
  const tasks = useAssetTasks();
  const { t } = useI18n();
  const toast = useToasts();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => watchAssetTasks((problem) => setError(!!problem)), []);
  const active = tasks.filter((task) => ["uploading", "queued", "running"].includes(task.state)).length;
  const failed = tasks.some((task) => ["failed", "interrupted"].includes(task.state));
  if (!tasks.length && !error) return null;
  return <aside className="background-tasks" aria-label={t("tasks.title")}>
    <button className="tasks-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className={active ? "task-spinner" : failed ? "err" : ""}>{active ? "◌" : failed ? "!" : "✓"}</span>
      {t("tasks.title")} · {active || tasks.length}
    </button>
    {open && <div className="tasks-list">
      {tasks.length > 0 && <div className="tasks-list-actions"><button className="ghost tiny" disabled={closing}
        title={t("tasks.dismissAllHint")} onClick={() => {
          if (closing) return;
          setClosing(true);
          dismissAllTasks().catch(error => toast.error(String(error.message ?? error))).finally(() => setClosing(false));
        }}>{t("tasks.dismissAll")}</button></div>}
      {error && <p className="muted">{t("tasks.reconnecting")}</p>}
      {tasks.map((task) => <div className="task-row" key={task.id}>
        <strong title={task.filename}>{task.filename}</strong>
        <span role="status">{t(`tasks.${task.phase}`)}</span>
        {task.target && <small>{t(task.attached === false ? "tasks.detached" : "tasks.destination", { name: task.target.page_name ?? "" })}</small>}
        {task.state === "done" && (task.item_ids?.length ?? 0) > 1 &&
          <small>{t("tasks.galleryItems", { count: task.item_ids!.length })}</small>}
        {task.error && <small className="err">{task.error}</small>}
        <div className="task-actions">
          {(task.state === "uploading" ? [] : ["queued", "running"].includes(task.state) ? ["cancel"] : task.state === "done" || task.local ? ["dismiss"] : ["retry", "dismiss"]).map((action) =>
            <button className="ghost tiny" key={action} onClick={() => taskAction(task.id, action as "cancel" | "retry" | "dismiss").catch((e) => toast.error(String(e.message ?? e)))}>{t(`tasks.${action}`)}</button>)}
          {task.state === "done" && task.item_id && <button className="ghost tiny" onClick={() => onOpenResult(task.item_id!)}>{t((task.item_ids?.length ?? 0) > 1 ? "tasks.firstResult" : "tasks.result")}</button>}
        </div>
      </div>)}
    </div>}
  </aside>;
}
