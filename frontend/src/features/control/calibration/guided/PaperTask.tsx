import { useEffect, useState } from "react";
import Segmented from "../../../../components/Segmented";
import EditorIcon from "../../../../components/editor/EditorIcon";
import EditorMenu from "../../../../components/editor/EditorMenu";
import XYJogPad from "../XYJogPad";
import { CORNERS, XY_STEPS } from "../steps";
import { useI18n } from "../../../../i18n";
import type { GuidedCalibrationTaskProps as Props } from "./types";

export default function PaperTask({ controls: c }: Props) {
  const { t } = useI18n();
  const cal = c.cal!;
  const [mode, setMode] = useState<"diagonal" | "manual">(
    cal.paper_diagonal || !Object.keys(cal.paper_corners).length ? "diagonal" : "manual",
  );
  const [diagonal, setDiagonal] = useState<"bl-tr" | "tl-br">(cal.paper_diagonal ?? "bl-tr");
  const order = mode === "diagonal" ? diagonal.split("-") : ["bl", "br", "tr", "tl"];
  const corner = order.includes(c.selectedCorner) ? c.selectedCorner : order[0];
  const index = order.indexOf(corner);
  const label = (id: string) => t(CORNERS.find(item => item.id === id)!.labelKey);
  const isGenerated = (id: string) => !!cal.paper_generated_corners?.includes(id)
    || (!!cal.paper_diagonal && !cal.paper_diagonal.split("-").includes(id));
  useEffect(() => { if (c.selectedCorner !== corner) c.setSelectedCorner(corner); }, [corner, c.selectedCorner]);
  const capture = async () => {
    const saved = await c.capture(corner, { mode, diagonal });
    if (saved) {
      if (index + 1 < order.length) c.setSelectedCorner(order[index + 1]);
      c.jogScope.current?.focus({ preventScroll: true });
    }
  };
  const changeMode = (value: "diagonal" | "manual") => {
    setMode(value); c.setSelectedCorner(value === "diagonal" ? diagonal.split("-")[0] : "bl");
  };
  return (
    <div className="calibration-task calibration-paper-task">
      <div className="calibration-paper-content">
      <Segmented value={mode} onChange={changeMode} options={[
        { value: "diagonal", label: t("paper.modeDiagonal") },
        { value: "manual", label: t("paper.modeManual") },
      ]} />
      <details className="calibration-corner-details"><summary>{t("paper.cornerHelp")}</summary>
      <p className="calibration-task-note">{t(mode === "diagonal" ? "paper.diagonalHint" : "paper.fourCornersHint")}</p>
      {mode === "diagonal" && <label className="calibration-diagonal-choice">
        {t("paper.chooseDiagonal")}
        <select value={diagonal} disabled={!c.canEdit} onChange={event => {
          const next = event.target.value as typeof diagonal;
          setDiagonal(next); c.setSelectedCorner(next.split("-")[0]);
        }}>
          <option value="bl-tr">{label("bl")} → {label("tr")}</option>
          <option value="tl-br">{label("tl")} → {label("br")}</option>
        </select>
      </label>}
      <details className="calibration-corner-details"><summary>{t("paper.savedCorners")}</summary>
      <div className="calibration-corner-summary">
        {CORNERS.map(({ id, labelKey }) => <span key={id} className={isGenerated(id) ? "generated" : "measured"}>
          {t(labelKey)} · {cal.paper_corners[id]?.map(value => value.toFixed(1)).join(" / ") ?? "—"}
          {cal.paper_corners[id] && <small>{t(isGenerated(id) ? "paper.cornerGenerated" : "paper.cornerMeasured")}</small>}
        </span>)}
      </div>
      </details>
      <p className="calibration-task-note">{t("paper.dragCornerHint")}</p>
      </details>
      <div className="calibration-corner-progress" role="status">
        <strong>{t("paper.cornerProgress", { current: index + 1, total: order.length })} · {label(corner)}</strong>
        <p>{t("paper.alignCornerInstruction", { corner: label(corner) })}</p>
      </div>
      </div>
      <div className="calibration-paper-controls">
      <span className="calibration-task-note">{t("paper.xyStep")}</span>
      <Segmented value={c.xyStep} onChange={c.setXyStep}
        options={XY_STEPS.map(value => ({ value, label: String(value) }))} suffix={<em>mm</em>} />
      <div className="calibration-capture-layout">
        <XYJogPad controls={c} />
        <div className="calibration-capture-choice">
          <select aria-label={t("calibration.corner")} value={corner}
            onChange={event => c.setSelectedCorner(event.target.value)}>
            {order.map(id => <option key={id} value={id}>{label(id)}{cal.paper_corners[id] && !isGenerated(id) ? " ✓" : ""}</option>)}
          </select>
          <button type="button" disabled={!c.canMove || !c.homed || !c.heightSaved}
            title={t("paper.testDotHint")} onClick={c.testDot}>{t("paper.testDot")}</button>
          <button type="button" className="primary" disabled={!c.canMove || !c.homed}
            onClick={() => void capture()}>{t("calibration.captureCorner")}</button>
          <button type="button" disabled={!c.canMove || !c.homed || !cal.paper_corners[corner]}
            aria-label={t("paper.driveCorner")} title={t("paper.driveCorner")} onClick={() => c.driveToCorner(corner, "paper")}>{t("paper.visitSavedCorner")}</button>
        </div>
      </div>
      <p className="calibration-task-note">{t("paper.keyboardJogHint")}</p>
      {!c.heightSaved && <p className="calibration-task-note">{t("paper.testDotNeedsHeight")}</p>}
      </div>
      <div className="calibration-task-actions">
        <EditorMenu label={t("paint.moreActions")} active={c.visible} items={[
          { id: "clear", label: t("paper.clearSelectedCorner"), disabled: !c.canEdit || !cal.paper_corners[corner], action: () => c.clearCorner(corner) },
          { id: "reset", label: t("paper.resetCorners"), disabled: !c.canEdit || c.capturedCount === 0, action: c.resetCorners },
          { id: "existing", label: t("paper.useCurrentArea"), action: () => c.setActive("apply") },
        ]}><EditorIcon name="more" size={17} /></EditorMenu>
        <button type="button" className="primary" disabled={!c.rect || !c.canEdit}
          onClick={() => void c.adoptPaperArea(true)}>{t("paper.usePaperArea")}</button>
      </div>
    </div>
  );
}
