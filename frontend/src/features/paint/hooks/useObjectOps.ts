import type { Calibration, Page, SceneObject } from "../../../api";
import type { ObjectOps } from "./objects/types";
import { useObjectCommandContext } from "./objects/useObjectCommandContext";
import { useTextCommands } from "./objects/useTextCommands";
import { useGeometryCommands } from "./objects/useGeometryCommands";
import { useSelectionCommands } from "./objects/useSelectionCommands";
import { useTransformCommands } from "./objects/useTransformCommands";
export type { ObjectOps } from "./objects/types";
export function useObjectOps(page: Page | null, cal: Calibration | null, selectedIds: string[], setPage: React.Dispatch<React.SetStateAction<Page | null>>, setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>, persist: (pageId: string, objects: SceneObject[]) => void, fail: (e: unknown) => void, warnMissingGlyphs: (missing: string[]) => void, defaultText: string, sizeLinked: boolean): ObjectOps {
    const context = useObjectCommandContext({ page, cal, selectedIds, setPage, setSelectedIds,
        persist, fail, warnMissingGlyphs, defaultText, sizeLinked });
    const text = useTextCommands(context);
    const geometry = useGeometryCommands(context);
    const selection = useSelectionCommands(context);
    const transforms = useTransformCommands(context);
    return { processing: context.processing > 0, history: context.history,
        remember: context.remember, resetHistory: context.resetHistory, undo: context.undo, redo: context.redo,
        ...text, ...geometry, ...selection, ...transforms };
}
