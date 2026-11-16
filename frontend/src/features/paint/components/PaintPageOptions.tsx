import EditorIcon from "../../../components/editor/EditorIcon";
import type { Page } from "../../../api";
import EditorMenu from "../../../components/editor/EditorMenu";
import { useI18n } from "../../../i18n";
export default function PaintPageOptions({
  page,
  onSetGrid,
  onSetContinuous,
  visible,
}: {
  page: Page;
  onSetGrid: (patch: Partial<{ step: number; snap: boolean }>) => void;
  onSetContinuous: (continuous: boolean) => void;
  visible: boolean;
}) {
  const { t } = useI18n();
  return (
    <EditorMenu
      label={t("paint.pageOptions")}
      active={visible}
      className="toolbar-icon-menu"
      items={[
        ...[1, 5, 10, 25, 50].map((step) => ({
          id: `grid-${step}`,
          label: t("paint.gridStepValue", { step }),
          checked: page.grid.step === step,
          radio: true,
          action: () => {
            if (page.grid.step !== step) onSetGrid({ step });
          },
        })),
        {
          id: "snap",
          label: t("paint.snapToGrid"),
          checked: page.grid.snap,
          separator: true,
          action: () => onSetGrid({ snap: !page.grid.snap }),
        },
        {
          id: "continuous",
          label: t("paint.modeContinuous"),
          checked: page.continuous !== false,
          radio: true,
          separator: true,
          action: () => {
            if (page.continuous === false) onSetContinuous(true);
          },
        },
        {
          id: "faithful",
          label: t("paint.modeFaithful"),
          checked: page.continuous === false,
          radio: true,
          action: () => {
            if (page.continuous !== false) onSetContinuous(false);
          },
        },
      ]}
    >
      <EditorIcon name="settings" size={18} />
    </EditorMenu>
  );
}
