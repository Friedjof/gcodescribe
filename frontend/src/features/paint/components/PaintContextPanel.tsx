import { useRef } from "react";
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
  onOpenGallery,
  onOpenMarkdown,
  onPickImage,
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
  onOpenGallery: () => void;
  onOpenMarkdown: () => void;
  onPickImage: (file: File | undefined) => void;
}) {
  const { t } = useI18n();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isFillTool = tool === "bucketFill" || tool === "areaFill";
  const canGroup = selectedObjects.length >= 2;
  const canUngroup = selectedObjects.some((obj) => obj.groupId);
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

  return (
    <aside className="paint-context-panel">
      <div className="ctx-header">
        <div className="ctx-active-tool">
          <span className="muted">{t("paint.activeTool")}</span>
          <strong>{activeToolLabel}</strong>
        </div>
        <div className="ctx-action-group">
          <span className="ctx-action-label">{t("paint.section.history")}</span>
          <div className="paint-tools-actions ctx-actions">
            <button className="ghost" disabled={ops.history.undo === 0} onClick={ops.undo}
              title={t("paint.undo")} aria-label={t("paint.undo")}>↶</button>
            <button className="ghost" disabled={ops.history.redo === 0} onClick={ops.redo}
              title={t("paint.redo")} aria-label={t("paint.redo")}>↷</button>
          </div>
        </div>
        <div className="ctx-action-group">
          <span className="ctx-action-label">{t("paint.section.clipboard")}</span>
          <div className="paint-tools-actions ctx-actions">
            <button className="ghost" disabled={!hasSelection} onClick={ops.copySelected}
              title={hasSelection ? t("paint.copySelection") : t("paint.noSelection")} aria-label={t("paint.copy")}>⧉</button>
            <button className="ghost" disabled={!hasSelection} onClick={ops.cutSelected}
              title={hasSelection ? t("paint.cutSelection") : t("paint.noSelection")} aria-label={t("paint.cut")}>✂</button>
            <button className="ghost" disabled={ops.clipboardCount === 0} onClick={() => ops.pasteObjects()}
              title={ops.clipboardCount > 0 ? t("paint.pasteSelection") : t("paint.clipboardEmpty")} aria-label={t("paint.paste")}>
              ⎘{ops.clipboardCount > 1 ? <span className="act-count">{ops.clipboardCount}</span> : ""}
            </button>
            <button className="ghost" disabled={!hasSelection} onClick={ops.duplicateSelected}
              title={hasSelection ? t("paint.duplicateSelection") : t("paint.noSelection")} aria-label={t("paint.duplicate")}>⊕</button>
          </div>
        </div>
        <div className="ctx-action-group">
          <span className="ctx-action-label">{t("paint.section.insert")}</span>
          <div className="paint-asset-row">
            <button className="ghost" onClick={onOpenGallery} title={t("gallery.button")}>
              ▦ <span>{t("gallery.button")}</span>
            </button>
            <button className="ghost" onClick={() => imageInputRef.current?.click()} title={t("paint.imageImport")}>
              🖼 <span>{t("paint.imageImport")}</span>
            </button>
            <button className="ghost" onClick={onOpenMarkdown} title={t("paint.md.button")}>
              ⌶ <span>{t("paint.md.button")}</span>
            </button>
          </div>
        </div>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => { onPickImage(e.target.files?.[0]); e.target.value = ""; }}
        />
      </div>

      <div className="ctx-body" key={tool}>
        {tool === "select" && (
          <div className="paint-tool-section">
            <h4>{t("paint.section.arrange")}</h4>
            <div className="paint-tools-actions compact">
              <button className="ghost" disabled={!hasSelection} onClick={ops.fitSelected}
                title={hasSelection ? t("paint.fitSelection") : t("paint.noSelection")} aria-label={t("paint.fit")}>⛶</button>
              <button className="ghost" disabled={!hasSelection} onClick={ops.centerSelected}
                title={hasSelection ? t("paint.centerSelection") : t("paint.noSelection")} aria-label={t("paint.center")}>⌖</button>
              <button className="ghost" disabled={!hasSelection} onClick={() => ops.moveSelected(-1)}
                title={hasSelection ? t("paint.moveBack") : t("paint.noSelection")} aria-label={t("paint.toBack")}>⤓</button>
              <button className="ghost" disabled={!hasSelection} onClick={() => ops.moveSelected(1)}
                title={hasSelection ? t("paint.moveFront") : t("paint.noSelection")} aria-label={t("paint.toFront")}>⤒</button>
              <button className="ghost" disabled={!hasSelection} onClick={ops.convertSelectedToLines}
                title={hasSelection ? t("paint.convertToLines") : t("paint.noSelection")} aria-label={t("paint.convertToLines")}>⇄</button>
              <button className="ghost" disabled={!canGroup} onClick={() => ops.groupSelected()}
                title={canGroup ? t("paint.groupSelection") : t("paint.needTwoObjects")} aria-label={t("paint.group")}>⊞</button>
              <button className="ghost" disabled={!canUngroup} onClick={() => ops.ungroupSelected()}
                title={canUngroup ? t("paint.ungroupSelection") : t("paint.noGroupSelected")} aria-label={t("paint.ungroup")}>⊟</button>
              <button className="ghost" disabled={!hasSelection} onClick={ops.deleteSelected}
                title={hasSelection ? t("paint.deleteSelection") : t("paint.noSelection")} aria-label={t("paint.delete")}>
                🗑{selectedObjects.length > 1 ? <span className="act-count">{selectedObjects.length}</span> : ""}
              </button>
            </div>
          </div>
        )}

        {tool === "select" && pressureObject && (
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

        {tool === "select" && selectedImage && (
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

        {(tool === "select" || tool === "text") && selectedText && (
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

        {tool === "select" && (
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
