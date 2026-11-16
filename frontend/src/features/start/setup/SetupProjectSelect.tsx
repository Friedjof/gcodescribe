import { useEffect, useId, useState } from "react";
import { api, type PageIndex, type PaintProject } from "../../../api";
import { flushEdits } from "../../../api/pageEdits";
import { errorMessage } from "../../../api/errors";
import { useI18n } from "../../../i18n";
import { useSetupTask } from "./useSetupTask";
import { useProjectCalibration } from "../../../state/ProjectCalibrationContext";

export default function SetupProjectSelect({
  index,
  enabled,
}: {
  index: PageIndex;
  enabled: boolean;
}) {
  const { t } = useI18n(),
    { setIndex } = useProjectCalibration(),
    id = useId();
  const [projects, setProjects] = useState<PaintProject[]>([]);
  const [loadError, setLoadError] = useState("");
  const task = useSetupTask(index.project!.id, enabled);
  const error = task.error || loadError;
  const [revision, reload] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    api
      .listProjects()
      .then((items) => {
        if (current) {
          setProjects(items);
          setLoadError("");
        }
      })
      .catch((error) => {
        if (current) setLoadError(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [index.project?.id, revision, enabled]);
  const change = (projectId: string) =>
    task.run(async (isCurrent) => {
      if (projectId === index.project?.id) return;
      if (index.activeId) await flushEdits(index.activeId);
      if (!isCurrent()) return;
      const next = await api.activateProject(projectId);
      setIndex(next);
    });
  const options = projects.filter(
    (project) => !project.archived || project.id === index.project?.id,
  );
  return (
    <div className="setup-project-select">
      <label htmlFor={id}>{t("setup.projectSelect")}</label>
      <select
        id={id}
        value={index.project?.id ?? ""}
        disabled={!enabled || task.busy}
        title={index.project?.name}
        onChange={(event) => void change(event.target.value)}
      >
        {!options.some((project) => project.id === index.project?.id) && (
          <option value={index.project?.id}>{index.project?.name}</option>
        )}
        {options.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {error && (
        <div className="setup-project-error" role="alert">
          <span>{error}</span>
          {!task.error && <button onClick={() => reload((value) => value + 1)}>
            {t("save.retry")}
          </button>}
        </div>
      )}
    </div>
  );
}
