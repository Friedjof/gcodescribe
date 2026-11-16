import { useRef } from "react";
import type { SceneObject } from "../../../api";
import EditorMenu, { type EditorMenuItem } from "../../../components/editor/EditorMenu";
import EditorIcon from "../../../components/editor/EditorIcon";
import { useI18n } from "../../../i18n";
import type { ObjectOps } from "../hooks/useObjectOps";

/** Document commands stay available even when the properties dock is closed. */
export default function PaintCommandBar({ ops, selected, visible, onText, onGallery, onMarkdown, onImage }: {
  ops: ObjectOps; selected: SceneObject[]; visible: boolean; onText: () => void; onGallery: () => void;
  onMarkdown: () => void; onImage: (file: File | undefined) => void;
}) {
  const { t } = useI18n(), input = useRef<HTMLInputElement>(null), hasSelection = selected.length > 0;
  const edit: EditorMenuItem[] = [
    {id:"copy",label:t("paint.copy"),shortcut:"Ctrl+C",disabled:!hasSelection,icon:"copy",action:ops.copySelected},
    {id:"cut",label:t("paint.cut"),shortcut:"Ctrl+X",disabled:!hasSelection,icon:"cut",action:ops.cutSelected},
    {id:"paste",label:t("paint.paste"),shortcut:"Ctrl+V",disabled:ops.clipboardCount === 0,icon:"paste",action:() => ops.pasteObjects()},
    {id:"duplicate",label:t("paint.duplicate"),shortcut:"Ctrl+D",disabled:!hasSelection,icon:"copy",action:ops.duplicateSelected},
    {id:"delete",label:t("paint.delete"),shortcut:"Delete",disabled:!hasSelection,icon:"trash",separator:true,action:ops.deleteSelected},
  ];
  const insert: EditorMenuItem[] = [
    {id:"text",label:t("paint.text"),icon:"text",action:onText},
    {id:"image",label:t("paint.imageImport"),icon:"image",action:() => input.current?.click()},
    {id:"gallery",label:t("gallery.button"),icon:"folder",action:onGallery},
    {id:"markdown",label:t("paint.md.button"),icon:"text",separator:true,action:onMarkdown},
  ];
  const arrange: EditorMenuItem[] = [
    {id:"center",label:t("paint.centerSelection"),disabled:!hasSelection,icon:"center",action:ops.centerSelected},
    {id:"fit",label:t("paint.fitSelection"),disabled:!hasSelection,icon:"fit",action:ops.fitSelected},
    {id:"back",label:t("paint.moveBack"),disabled:!hasSelection,icon:"down",separator:true,action:() => ops.moveSelected(-1)},
    {id:"front",label:t("paint.moveFront"),disabled:!hasSelection,icon:"up",action:() => ops.moveSelected(1)},
    {id:"group",label:t("paint.groupSelection"),disabled:selected.length < 2,icon:"group",separator:true,action:() => ops.groupSelected()},
    {id:"ungroup",label:t("paint.ungroupSelection"),disabled:!selected.some(object => object.groupId),icon:"group",action:() => ops.ungroupSelected()},
    {id:"lines",label:t("paint.convertToLines"),disabled:!hasSelection,icon:"line",separator:true,action:ops.convertSelectedToLines},
  ];
  return <div className="paint-command-bar" role="toolbar" aria-label={t("interface.documentCommands")}>
    <button type="button" className="icon-button" title={t("paint.undo")} aria-label={t("paint.undo")} disabled={ops.history.undo === 0} onClick={ops.undo}><EditorIcon name="undo" size={17} /></button>
    <button type="button" className="icon-button" title={t("paint.redo")} aria-label={t("paint.redo")} disabled={ops.history.redo === 0} onClick={ops.redo}><EditorIcon name="redo" size={17} /></button>
    <span className="toolbar-divider" />
    <EditorMenu label={t("interface.edit")} items={edit} active={visible} className="toolbar-icon-menu"><EditorIcon name="paste" size={18}/></EditorMenu>
    <EditorMenu label={t("paint.section.insert")} items={insert} active={visible} className="toolbar-icon-menu"><EditorIcon name="image" size={18}/></EditorMenu>
    <EditorMenu label={t("paint.section.arrange")} items={arrange} active={visible} className="toolbar-icon-menu"><EditorIcon name="group" size={18}/></EditorMenu>
    <input type="file" accept="image/*" hidden ref={input} onChange={event => { onImage(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
  </div>;
}
