import EditorIcon from "../../../components/editor/EditorIcon";
import { useInterface } from "../../../interface/InterfaceProvider";
import { useI18n } from "../../../i18n";

/** Layout changes affect only the local view, never the saved drawing geometry. */
export default function PaintLayoutControls() {
  const { preferences: prefs, update } = useInterface(), { t } = useI18n();
  return <div className="paint-layout-controls" aria-label={t("interface.canvasView")}>
    <button type="button" aria-pressed={prefs.pagesPanel.open} onClick={() => update(p => ({ ...p, pagesPanel: { ...p.pagesPanel, open: !p.pagesPanel.open } }))}>
      <EditorIcon name="pages" size={15} />{t("interface.pages")}</button>
    <button type="button" aria-pressed={prefs.propertiesPanel.open} onClick={() => update(p => ({ ...p, propertiesPanel: { ...p.propertiesPanel, open: !p.propertiesPanel.open } }))}>
      <EditorIcon name="panel" size={15} />{t("interface.properties")}</button>
    <span className="toolbar-divider" />
    <button type="button" aria-pressed={prefs.canvas.gridVisible} onClick={() => update(p => ({ ...p, canvas: { ...p.canvas, gridVisible: !p.canvas.gridVisible } }))}>
      <EditorIcon name="grid" size={15} />{t("paint.grid")}</button>
    <button type="button" aria-pressed={prefs.canvas.rulers} onClick={() => update(p => ({ ...p, canvas: { ...p.canvas, rulers: !p.canvas.rulers } }))}>
      <EditorIcon name="measure" size={15} />{t("interface.rulers")}</button>
    <label>{t("interface.canvasPadding")}<select value={prefs.canvas.padding}
      onChange={event => update(p => ({ ...p, canvas: { ...p.canvas, padding: Number(event.target.value) } }))}>
      {[0, 16, 32, 48, 72].map(value => <option key={value} value={value}>{value} px</option>)}
      {![0, 16, 32, 48, 72].includes(prefs.canvas.padding) && <option value={prefs.canvas.padding}>{prefs.canvas.padding} px</option>}
    </select></label>
  </div>;
}
