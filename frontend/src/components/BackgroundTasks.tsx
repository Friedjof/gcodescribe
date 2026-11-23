import { useEffect, useState } from "react";
import { useAssetTasks, watchAssetTasks, taskAction, dismissAllTasks } from "../api/assetTasks";
import { useI18n } from "../i18n";
import { useToasts } from "./Toasts";
import EditorIcon from "./editor/EditorIcon";

export default function BackgroundTasks({ onOpenResult }: { onOpenResult: (id: string) => void }) {
  const tasks = useAssetTasks();
  const { t } = useI18n();
  const toast = useToasts();
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem("gcs.tasks.compact.v1") === "true"; } catch { return false; }
  });
  const [error, setError] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => watchAssetTasks((problem) => setError(!!problem)), []);
  const active = tasks.filter((task) => ["uploading", "queued", "running"].includes(task.state)).length;
  const failed = tasks.some((task) => ["failed", "interrupted"].includes(task.state));
  const summary = t("tasks.summary", { active, done: tasks.filter(task => task.state === "done").length,
    failed: tasks.filter(task => ["failed", "interrupted"].includes(task.state)).length });
  const minimize = () => {
    setCompact(true); setOpen(false);
    try { localStorage.setItem("gcs.tasks.compact.v1", "true"); } catch { /* In-memory preference. */ }
  };
  if (!tasks.length && !error) return null;
  return <aside className={`background-tasks${compact && !open ? " tasks-mini" : ""}`} aria-label={t("tasks.title")}>
    <div className="tasks-toggle-row"><button className="tasks-toggle" onClick={() => setOpen(!open)} aria-expanded={open}
      aria-label={`${t("tasks.title")} · ${summary}`} title={summary}>
      <span className={failed || error ? "err" : ""}><EditorIcon name="bell" size={compact && !open ? 15 : 17}/></span>
      {compact && !open ? <span className="tasks-counter">{tasks.length}</span> : <>{t("tasks.title")} · {tasks.length}</>}
    </button>
    {(!compact || open) && <button className="ghost tiny tasks-minimize" title={t("tasks.compact")} aria-label={t("tasks.compact")} onClick={minimize}><EditorIcon name="down" size={13}/></button>}</div>
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
