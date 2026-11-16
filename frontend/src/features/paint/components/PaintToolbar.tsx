import type { ReactNode } from "react";
import type { Page } from "../../../api";
import PaintPageOptions from "./PaintPageOptions";
import PaintJobActions, { type PaintJobActionsProps } from "./PaintJobActions";

/** A compact document header. View options and job commands own their own menus. */
export default function PaintToolbar({
  page,
  onSetGrid,
  onSetContinuous,
  guided = false,
  visible = true,
  commands,
  viewControls,
  ...jobProps
}: PaintJobActionsProps & {
  page: Page;
  onSetGrid: (patch: Partial<{ step: number; snap: boolean }>) => void;
  onSetContinuous: (continuous: boolean) => void;
  guided?: boolean;
  visible?: boolean;
  commands?: ReactNode;
  viewControls?: ReactNode;
}) {
  return (
    <div className="paint-toolbar">
      <div className="paint-toolbar-left">
        {commands ?? <h2 title={page.name}>{page.name}</h2>}
        <PaintPageOptions
          page={page}
          onSetGrid={onSetGrid}
          onSetContinuous={onSetContinuous}
          visible={visible}
        />
        {viewControls}
      </div>
      <PaintJobActions
        {...jobProps}
        hasObjects={page.objects.length > 0}
        guided={guided}
        visible={visible}
      />
    </div>
  );
}
