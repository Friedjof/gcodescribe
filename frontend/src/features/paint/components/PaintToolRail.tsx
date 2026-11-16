import EditorIcon, { type EditorIconName } from "../../../components/editor/EditorIcon";
import EditorMenu from "../../../components/editor/EditorMenu";
import { useI18n } from "../../../i18n";
import type { Tool } from "../PaintCanvas";

interface ToolMeta { value: Tool; label: string; icon: EditorIconName }
export function paintTools(t: (key: string) => string): ToolMeta[] {
  return [
    { value: "select", label: t("paint.tool.select"), icon: "select" },
    { value: "pen", label: t("paint.tool.pen"), icon: "draw" },
    { value: "line", label: t("paint.tool.line"), icon: "line" },
    { value: "rect", label: t("paint.tool.rect"), icon: "shape" },
    { value: "circle", label: t("paint.tool.circle"), icon: "circle" },
    { value: "text", label: t("paint.tool.text"), icon: "text" },
    { value: "erase", label: t("paint.tool.erase"), icon: "eraser" },
    { value: "semicircle", label: t("paint.tool.semicircle"), icon: "semicircle" },
    { value: "bucketFill", label: t("paint.tool.bucketFill"), icon: "bucket" },
    { value: "areaFill", label: t("paint.tool.areaFill"), icon: "grid" },
    { value: "maskRect", label: t("paint.tool.maskRect"), icon: "shape" },
    { value: "maskCircle", label: t("paint.tool.maskCircle"), icon: "circle" },
    { value: "eraseLine", label: t("paint.tool.eraseLine"), icon: "cut" },
  ];
}
const BASICS: Tool[] = ["select", "pen", "line", "rect", "circle", "text", "erase"];

/** Common tools are always visible; specialist tools remain one click away. */
export default function PaintToolRail({ tool, onToolChange, guided = false, visible = true }: {
  tool: Tool; onToolChange: (tool: Tool) => void; guided?: boolean; visible?: boolean;
}) {
  const { t } = useI18n(), tools = paintTools(t);
  const displayed = guided ? tools.filter(item => BASICS.includes(item.value) || item.value === tool) : tools;
  return <nav data-tour="paint-tools" className="paint-tool-rail editor-tool-rail" aria-label={t("paint.activeTool")}>
    {displayed.map(item => <button key={item.value} type="button" aria-label={item.label} title={item.label}
      aria-pressed={tool === item.value} className={tool === item.value ? "active" : ""} onClick={() => onToolChange(item.value)}>
      <EditorIcon name={item.icon} size={19} />
    </button>)}
    {guided && <EditorMenu label={t("interface.moreTools")} active={visible} className="more-tools-trigger"
      items={tools.filter(item => !BASICS.includes(item.value)).map(item => ({ id: item.value, label: item.label, icon: item.icon, action: () => onToolChange(item.value) }))}>
      <EditorIcon name="more" size={19} />
    </EditorMenu>}
  </nav>;
}
