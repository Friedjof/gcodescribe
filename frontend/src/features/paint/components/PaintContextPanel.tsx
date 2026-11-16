import { useState } from "react";
import EditorIcon from "../../../components/editor/EditorIcon";
import type { SceneObject } from "../../../api";
import Segmented from "../../../components/Segmented";
import { useI18n } from "../../../i18n";
import type { Tool } from "../PaintCanvas";
import type { ObjectOps } from "../hooks/useObjectOps";
import type { EraserBrush } from "../lib/eraser";
import type { TextFont } from "../lib/text";
import type { FillStyle, VectorStyle } from "../lib/styling";
import { FillOptions } from "./FillOptions";
import { PaintStylePanel } from "./PaintStylePanel";
import { PaintTextPanel } from "./PaintTextPanel";
import { imageBlankMargins, type TrimSide } from "../lib/imageTrim";
import { isPressureObject } from "../lib/pressure";
import { keepsStrokeFeeds, objectStyle } from "../lib/sceneObjects";

/** Right-side context panel: history/clipboard actions, asset insertion, and
 * the per-tool section (arrange+style+text for select, brush size for erasers,
 * fill options for the fill tools). */
export default function PaintContextPanel({
  tool,
  activeToolLabel,
  ops,
  hasSelection,
  selectedObjects,
  selectedStyle,
  pressureMaxDepth = 0,
  selectedText,
  defaultText,
  eraserBrush,
  onEraserBrushChange,
  eraserRadius,
  fillStyle,
  onFillStyleChange,
}: {
  tool: Tool;
  activeToolLabel: string;
  ops: ObjectOps;
  hasSelection: boolean;
  selectedObjects: SceneObject[];
  selectedStyle: VectorStyle;
  pressureMaxDepth?: number;
  selectedText: SceneObject | null;
  defaultText: string;
  eraserBrush: EraserBrush;
  onEraserBrushChange: (brush: EraserBrush) => void;
  eraserRadius: number;
  fillStyle: FillStyle;
  onFillStyleChange: (patch: Partial<FillStyle>) => void;
}) {
  const { t } = useI18n();
  const [panel, setPanel] = useState("content");
  const isFillTool = tool === "bucketFill" || tool === "areaFill";
  const selectedImage = selectedObjects.length === 1 && selectedObjects[0].type === "image"
    ? selectedObjects[0] : null;
  const blankMargins = selectedImage ? imageBlankMargins(selectedImage) : null;
  const pressureObject = selectedObjects.length === 1 && isPressureObject(selectedObjects[0]) ? selectedObjects[0] : null;
  const pressureStyleSupported = !!pressureObject && keepsStrokeFeeds(objectStyle(pressureObject));
  const trimSides: { side: TrimSide; symbol: string }[] = [
    { side: "left", symbol: "←" }, { side: "right", symbol: "→" },
    { side: "top", symbol: "↑" }, { side: "bottom", symbol: "↓" },
  ];
  const canTrim = !!blankMargins && Object.values(blankMargins).some((margin) => margin >= 0.05);

  const hasContent = !!selectedText || !!selectedImage || !!pressureObject;
  const showContent = tool !== "select" || panel === "content";
  const showStyle = tool === "select" && (!hasContent || panel === "style");
  return (
    <aside className="paint-context-panel">
      <div className="ctx-header">
        <div className="ctx-active-tool">
          <span className="muted">{t("paint.activeTool")}</span>
          <strong>{activeToolLabel}</strong>
        </div>
      </div>

      {tool === "select" && hasSelection && hasContent && <nav className="ctx-property-tabs"><button type="button" aria-pressed={panel === "content"} onClick={() => setPanel("content")}><EditorIcon name={selectedText ? "text" : "image"} size={15}/>{t("paint.properties.content")}</button><button type="button" aria-pressed={panel === "style"} onClick={() => setPanel("style")}><EditorIcon name="draw" size={15}/>{t("paint.properties.style")}</button></nav>}
      <div className="ctx-body" key={tool}>
        {!["select", "erase", "eraseLine", "bucketFill", "areaFill"].includes(tool) && !selectedText && <div className="inspector-empty">
          <h4>{activeToolLabel}</h4><p>{t(tool === "text" ? "paint.hint.text" : "paint.hint.draw")}</p>
          <p>{t("interface.shapeHint")}</p>
        </div>}
        {tool === "select" && !hasSelection && <div className="inspector-empty">
          <h4>{t("interface.selectObject")}</h4><p>{t("interface.selectObjectHint")}</p>
          <p>{t("interface.insertHint")}</p>
        </div>}
        {tool === "select" && showContent && pressureObject && (
          <div className="paint-tool-section paint-pressure">
            <h4>{t("paint.pressure.title")}</h4>
            <label className="paint-pressure-switch">
              <input type="checkbox" checked={pressureObject.data?.pressureEnabled === true}
                disabled={pressureObject.plotted || ops.processing ||
                  (!pressureObject.data?.pressureEnabled && (pressureMaxDepth <= 0 || !pressureStyleSupported))}
                onChange={(event) => ops.setSelectedPressureEnabled(event.target.checked)} />
              <span>{t("paint.pressure.enable")}</span>
            </label>
            <p>{t("paint.pressure.hint")}</p>
            {pressureMaxDepth <= 0 ? <p role="note">{t("paint.pressure.configure")}</p>
              : <p>{t("paint.pressure.depth", { depth: pressureMaxDepth })}</p>}
            {!pressureStyleSupported && <p role="note">{t("paint.pressure.solidOnly")}</p>}
          </div>
        )}

        {tool === "select" && showContent && selectedImage && (
          <div className="paint-tool-section paint-image-trim">
            <h4>{t("paint.image.trimTitle")}</h4>
            <p>{t("paint.image.trimHint")}</p>
            {blankMargins ? <>
              <div className="paint-image-trim-grid">
                {trimSides.map(({ side, symbol }) => (
                  <button key={side} type="button" className="ghost"
                    disabled={selectedImage.plotted || blankMargins[side] < 0.05}
                    onClick={() => ops.trimSelectedImage([side])}>
                    <span aria-hidden="true">{symbol}</span> {t(`paint.image.trim.${side}`)} · {blankMargins[side].toFixed(1)} mm
                  </button>
                ))}
              </div>
              <div className="paint-image-trim-actions">
                <button type="button" className="ghost" disabled={selectedImage.plotted || !canTrim}
                  onClick={() => ops.trimSelectedImage(trimSides.map(({ side }) => side))}>
                  {t("paint.image.trimAll")}
                </button>
                <button type="button" className="ghost"
                  disabled={selectedImage.plotted || !selectedImage.data?.sourcePage?.trim}
                  onClick={ops.resetSelectedImageTrim}>{t("paint.image.trimReset")}</button>
              </div>
            </> : <small>{t("paint.image.trimAlready")}</small>}
          </div>
        )}

        {(tool === "select" || tool === "text") && showContent && selectedText && (
          <div className="paint-tool-section">
            <h4>{t("paint.section.text")}</h4>
            <PaintTextPanel key={selectedText.id}
              selectedText={selectedText}
              draftText={ops.draftText}
              defaultText={defaultText}
              onTextInput={ops.onTextInput}
              onFontOrSizeChange={(id: string, patch: Partial<{ text: string; size: number; font: TextFont }>) =>
                ops.onFontOrSizeChange(id, patch)}
            />
          </div>
        )}

        {showStyle && hasSelection && (
          <PaintStylePanel key={selectedObjects.map(object => object.id).join(":")}
            hasSelection={hasSelection}
            selectedStyle={selectedStyle}
            onStyleChange={ops.updateSelectedStyle}
          />
        )}

        {(tool === "erase" || tool === "eraseLine") && (
          <div className="paint-tool-section">
            <h4>{t("paint.section.erase")}</h4>
            <Segmented<EraserBrush>
              value={eraserBrush}
              onChange={onEraserBrushChange}
              options={[
                { value: "point", label: t("paint.coloringBrushPoint"), title: t("paint.coloringBrushPoint") },
                { value: "small",  label: t("paint.coloringBrushSmall"),  title: t("paint.coloringBrushSize") },
                { value: "medium", label: t("paint.coloringBrushMedium"), title: t("paint.coloringBrushSize") },
                { value: "large",  label: t("paint.coloringBrushLarge"),  title: t("paint.coloringBrushSize") },
              ]}
              className="paint-tool-grid"
            />
            {eraserBrush !== "point" && (
              <div className="coloring-brush-hint">⌀ {Math.round(eraserRadius * 2)} mm</div>
            )}
          </div>
        )}

        {isFillTool && (
          <div className="paint-tool-section">
            <h4>{t("paint.fillOptions")}</h4>
            <FillOptions value={fillStyle} onChange={onFillStyleChange} />
          </div>
        )}
      </div>
    </aside>
  );
}
