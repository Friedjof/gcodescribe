import { useState } from "react";
import {
  api,
  type CalibrationProfile,
  type GcodePreview3D,
  type PageIndex,
} from "../../../api";
import { flushEdits } from "../../../api/pageEdits";
import Gcode3D from "../../../components/Gcode3D";
import { useI18n } from "../../../i18n";
import { useSetupTask } from "./useSetupTask";
export default function SetupPreviewStep({
  index,
  profile,
  active,
  onReviewed,
  onDraw,
  onFinish,
  ready,
}: {
  index: PageIndex;
  profile: CalibrationProfile;
  active: boolean;
  ready: boolean;
  onReviewed: (pageId: string, modified: number, fingerprint: string) => void;
  onDraw: () => void;
  onFinish: () => void;
}) {
  const { t } = useI18n(),
    page = index.order.find((page) => page.id === index.activeId);
  const scope = JSON.stringify([page?.id, page?.modified, profile.fingerprint]);
  const [preview, setPreview] = useState<{
      scope: string;
      data: GcodePreview3D;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const task = useSetupTask(scope, active),
    data = preview?.scope === scope ? preview.data : null;
  const load = () =>
    task.run(async (isCurrent) => {
      if (!page) return;
      await flushEdits(page.id);
      const saved = await api.getPage(page.id);
      if (!isCurrent() || saved.projectId !== index.project?.id) return;
      const data = await api.pagePreview3D(page.id, saved.objects, profile);
      if (!isCurrent()) return;
      setPreview({ scope, data });
      setConfirmed(false);
      onReviewed(page.id, saved.modified, profile.fingerprint);
    });
  return (
    <section className="setup-step-content setup-preview">
      <h2>{t("setup.previewTitle")}</h2>
      <p className="setup-lead">{t("setup.previewIntro")}</p>
      <div data-tour="setup-preview" className="setup-actions">
        <button
          className="primary"
          disabled={!page?.objectCount || task.busy}
          onClick={() => void load()}
        >
          {t(task.busy ? "common.loading" : "setup.loadPreview")}
        </button>
        <button onClick={onDraw}>{t("setup.editDrawing")}</button>
      </div>
      {task.error && (
        <p className="banner err" role="alert">
          {task.error}
        </p>
      )}
      {data && (
        <>
          <Gcode3D data={data} />
          <label className="setup-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t("setup.confirmPreview")}
          </label>
          <p className="setup-note">{t("setup.previewNote")}</p>
          <button className="primary" disabled={!confirmed} onClick={onFinish}>
            {t(ready ? "setup.finish" : "setup.finishOffline")}
          </button>
        </>
      )}
    </section>
  );
}
