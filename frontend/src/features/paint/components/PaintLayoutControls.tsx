import EditorIcon from "../../../components/editor/EditorIcon";
import EditorMenu, {
  type EditorMenuItem,
} from "../../../components/editor/EditorMenu";
import { useInterface } from "../../../interface/InterfaceProvider";
import { useI18n } from "../../../i18n";

/** View-only choices stay in one menu instead of occupying the document surface. */
export default function PaintLayoutControls({
  measurementsOpen,
  onToggleMeasurements,
  visible,
}: {
  measurementsOpen: boolean;
  onToggleMeasurements: () => void;
  visible: boolean;
}) {
  const { preferences: prefs, update } = useInterface(),
    { t } = useI18n();
  const items: EditorMenuItem[] = [
    {
      id: "pages",
      label: t("interface.pages"),
      icon: "pages",
      checked: prefs.pagesPanel.open,
      action: () =>
        update((p) => ({
          ...p,
          pagesPanel: { ...p.pagesPanel, open: !p.pagesPanel.open },
        })),
    },
    {
      id: "properties",
      label: t("interface.properties"),
      icon: "panel",
      checked: prefs.propertiesPanel.open,
      action: () =>
        update((p) => ({
          ...p,
          propertiesPanel: {
            ...p.propertiesPanel,
            open: !p.propertiesPanel.open,
          },
        })),
    },
    {
      id: "measurements",
      label: t("paint.measure.title"),
      icon: "measure",
      checked: measurementsOpen,
      action: onToggleMeasurements,
    },
    {
      id: "grid",
      label: t("paint.grid"),
      icon: "grid",
      checked: prefs.canvas.gridVisible,
      separator: true,
      action: () =>
        update((p) => ({
          ...p,
          canvas: { ...p.canvas, gridVisible: !p.canvas.gridVisible },
        })),
    },
    {
      id: "rulers",
      label: t("interface.rulers"),
      icon: "measure",
      checked: prefs.canvas.rulers,
      action: () =>
        update((p) => ({
          ...p,
          canvas: { ...p.canvas, rulers: !p.canvas.rulers },
        })),
    },
    ...[0, 16, 32, 48, 72].map((padding, index) => ({
      id: `padding-${padding}`,
      label: t("paint.viewPadding", { padding }),
      checked: prefs.canvas.padding === padding,
      radio: true,
      separator: index === 0,
      action: () => update((p) => ({ ...p, canvas: { ...p.canvas, padding } })),
    })),
  ];
  return (
    <div className="paint-layout-controls">
      <button
        type="button"
        className="icon-button"
        aria-label={t("interface.properties")}
        title={t("interface.properties")}
        aria-pressed={prefs.propertiesPanel.open}
        onClick={() =>
          update((p) => ({
            ...p,
            propertiesPanel: {
              ...p.propertiesPanel,
              open: !p.propertiesPanel.open,
            },
          }))
        }
      >
        <EditorIcon name="panel" size={18} />
      </button>
      <EditorMenu
        label={t("interface.canvasView")}
        items={items}
        active={visible}
        className="toolbar-icon-menu"
      >
        <EditorIcon name="preview" size={18} />
      </EditorMenu>
    </div>
  );
}
