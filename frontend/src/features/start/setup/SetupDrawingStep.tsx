import { useRef, useState } from "react";
import {
  api,
  type CalibrationProfile,
  type PageIndex,
  type SceneObject,
} from "../../../api";
import { appendObject, flushEdits } from "../../../api/pageEdits";
import { useI18n } from "../../../i18n";
import { localBounds } from "../../paint/lib/geometry";
import { textGeometryAsync } from "../../paint/lib/sceneObjects";
import { DEFAULT_VECTOR_STYLE } from "../../paint/lib/styling";
import { useSetupTask } from "./useSetupTask";
import PageThumbnail from "../../paint/PageThumbnail";

export default function SetupDrawingStep({
  index,
  profile,
  active,
  onRefresh,
  onDraw,
  onTemplates,
  onNext,
}: {
  index: PageIndex;
  profile: CalibrationProfile;
  active: boolean;
  onRefresh: () => Promise<unknown>;
  onDraw: () => void;
  onTemplates: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n(),
    [text, setText] = useState(t("setup.sampleText"));
  const page = index.order.find((page) => page.id === index.activeId),
    task = useSetupTask(
      JSON.stringify([page?.id, profile.fingerprint]),
      active,
    );
  const objectId = useRef(crypto.randomUUID());
  const create = () =>
    task.run(async (isCurrent) => {
      if (!page || !text.trim() || text.length > 120) return;
      await flushEdits(page.id);
      const saved = await api.getPage(page.id);
      if (!isCurrent() || saved.projectId !== index.project?.id) return;
      // An existing page is never replaced by a sample, including concurrent edits.
      if (saved.objects.length) {
        await onRefresh();
        return;
      }
      const geometry = await textGeometryAsync(text.trim(), 12, "sans");
      if (!isCurrent()) return;
      if (geometry.missing?.length)
        throw new Error(
          t("setup.missingGlyphs", { chars: geometry.missing.join(" ") }),
        );
      const bounds = localBounds(geometry.local),
        width = bounds[2] - bounds[0],
        height = bounds[3] - bounds[1];
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height))
        throw new Error(t("setup.emptyText"));
      const cal = profile.calibration,
        scale = Math.min(
          1,
          (cal.plot_width * 0.7) / width,
          (cal.plot_height * 0.3) / Math.max(height, 1),
        );
      const object: SceneObject = {
        id: objectId.current,
        type: "text",
        plotted: false,
        data: {
          text: text.trim(),
          mode: "single-line",
          size: 12,
          font: "sans",
          seed: 0,
          basePolylines: geometry.local,
          style: DEFAULT_VECTOR_STYLE,
        },
        cachedPolylines: geometry.local,
        cachedFeeds: geometry.feeds,
        transform: {
          x: cal.plot_width / 2,
          y: cal.plot_height / 2,
          rotation: 0,
          scale,
        },
      };
      await appendObject(page.id, object);
      if (saved.name === saved.id)
        await api.savePage(page.id, { name: t("setup.firstPageName") });
      await onRefresh();
      if (isCurrent()) onNext();
    });
  return (
    <section className="setup-step-content">
      <h2>{t("setup.drawingTitle")}</h2>
      <p className="setup-lead">{t("setup.drawingIntro")}</p>
      {page && page.objectCount > 0 ? (
        <div className="setup-existing">
          <PageThumbnail page={page} />
          <div>
            <strong>{page.name}</strong>
            <span>{t("setup.pageReady", { count: page.objectCount })}</span>
          </div>
          <button className="primary" onClick={onNext}>
            {t("setup.continuePreview")}
          </button>
        </div>
      ) : (
        <form
          className="setup-sample-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <h3>{t("setup.simpleText")}</h3>
          <p>{t("setup.simpleTextHint")}</p>
          <label>
            {t("setup.textLabel")}
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={120}
              required
              disabled={task.busy}
            />
          </label>
          <button
            type="submit"
            className="primary"
            disabled={task.busy || !page || !text.trim()}
          >
            {t(task.busy ? "common.loading" : "setup.createTextPage")}
          </button>
        </form>
      )}
      {task.error && (
        <p className="banner err" role="alert">
          {task.error}
        </p>
      )}
      <div className="setup-actions">
        <button onClick={onDraw}>{t("start.openDrawing")}</button>
        <button onClick={onTemplates}>{t("start.templates")}</button>
      </div>
      <p className="setup-note">{t("setup.drawingNote")}</p>
    </section>
  );
}
