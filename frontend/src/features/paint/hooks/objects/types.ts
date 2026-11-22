import type { SceneObject } from "../../../../api";
import type { Pt, Transform } from "../../lib/geometry";
import type { TrimSide } from "../../lib/imageTrim";
import type { VectorStyle } from "../../lib/styling";
import type { TextFont } from "../../lib/text";
export interface ObjectOps {
    processing: boolean;
    pendingStyle?: VectorStyle;
    history: {
        undo: number;
        redo: number;
    };
    clipboardCount: number;
    draftText: string | null;
    resetHistory: () => void;
    remember: () => void;
    undo: () => void;
    redo: () => void;
    addObject: (obj: SceneObject) => void;
    addObjects: (objs: SceneObject[]) => void;
    eraseAcrossObjects: (path: Pt[], mode: "free" | "line", radius: number) => void;
    updateTextObject: (id: string, patch: Partial<{
        text: string;
        size: number;
        font: TextFont;
    }>) => void;
    onTextInput: (id: string, text: string) => void;
    onFontOrSizeChange: (id: string, patch: Partial<{
        text: string;
        size: number;
        font: TextFont;
    }>) => void;
    deleteSelected: () => void;
    updateSelectedStyle: (patch: Partial<VectorStyle>) => void;
    setSelectedPressureEnabled: (enabled: boolean) => void;
    groupSelected: (ids?: string[]) => void;
    ungroupSelected: (ids?: string[]) => void;
    applyMaskStamp: (maskId: string) => void;
    convertSelectedToLines: () => void;
    clipToPlot: () => Promise<boolean>;
    copySelected: () => void;
    cutSelected: () => void;
    pasteObjects: (source?: SceneObject[]) => void;
    duplicateSelected: () => void;
    moveSelected: (dir: -1 | 1) => void;
    markPlotted: (ids: string[]) => void;
    selectionBounds: () => [
        number,
        number,
        number,
        number
    ] | null;
    objectLocalSize: (obj: SceneObject) => {
        width: number;
        height: number;
        localWidth: number;
        localHeight: number;
    } | null;
    setSelectedObjectSize: (axis: "width" | "height", target: number) => boolean;
    setSelectedObjectRotation: (degrees: number) => boolean;
    setSelectedObjectPosition: (axis: "x" | "y", target: number) => boolean;
    trimSelectedImage: (sides: TrimSide[]) => void;
    resetSelectedImageTrim: () => void;
    mapSelected: (fn: (t: Transform) => Transform) => void;
    fitSelected: () => void;
    centerSelected: () => void;
    nudgeSelected: (dx: number, dy: number) => void;
    editSelectedText: (edit: (text: string) => string) => boolean;
}
