import { type SceneObject } from "../../../../api";
import { IDENTITY, objectWorldBounds, type Pt, type Transform } from "../../lib/geometry";
import { basePolylines } from "../../lib/sceneObjects";
import { resetImageBlankEdges, trimImageBlankEdges, type TrimSide } from "../../lib/imageTrim";
import { measurementTransform, objectMeasurements, type MeasurementEdit } from "../../lib/objectMeasurements";
import { sameTransform } from "../../lib/canvasTransforms";
import { sourcePageFrame } from "../../lib/sourcePage";
import type { ObjectCommandContext } from "./useObjectCommandContext";
export function useTransformCommands(context: ObjectCommandContext) {
    const { page, cal, selectedIds, setPage, persist, remember, sizeLinked, latestPage, latestSelection } = context;
    const selectionBounds = (): [
        number,
        number,
        number,
        number
    ] | null => {
        if (!page || selectedIds.length === 0)
            return null;
        const sel = new Set(selectedIds);
        let b: [
            number,
            number,
            number,
            number
        ] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const obj of page.objects) {
            if (!sel.has(obj.id))
                continue;
            const local = sourcePageFrame(obj) ?? ((obj.cachedPolylines as Pt[][] | undefined) ?? basePolylines(obj));
            if (!local.length)
                continue;
            const [x0, y0, x1, y1] = objectWorldBounds(local, obj.transform ?? IDENTITY);
            b = [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)];
        }
        return Number.isFinite(b[0]) ? b : null;
    };
    const objectLocalSize = (object: SceneObject) => objectMeasurements(object);
    const editMeasurement = (edit: MeasurementEdit): boolean => {
        const current = latestPage.current;
        if (!page || current?.id !== page.id || selectedIds.length !== 1 ||
            latestSelection.current.length !== 1 || latestSelection.current[0] !== selectedIds[0]) return false;
        const object = current.objects.find(item => item.id === selectedIds[0]);
        if (!object) return false;
        const transform = measurementTransform(object, edit, cal);
        if (!transform) return false;
        if (sameTransform(transform, object.transform ?? IDENTITY)) return true;
        remember(current.objects);
        const objects = current.objects.map(item => item.id === object.id ? { ...item, transform, plotted: false } : item);
        const next = { ...current, objects }; latestPage.current = next; setPage(next);
        persist(current.id, objects);
        return true;
    };
    const setSelectedObjectSize = (axis: "width" | "height", value: number) => editMeasurement({ kind: "size", axis, value, linked: sizeLinked });
    const setSelectedObjectRotation = (value: number) => editMeasurement({ kind: "rotation", value });
    const setSelectedObjectPosition = (axis: "x" | "y", value: number) => editMeasurement({ kind: "position", axis, value });
    const changeSelectedImage = (change: (obj: SceneObject) => SceneObject | null) => {
        if (!page || selectedIds.length !== 1)
            return;
        const obj = page.objects.find((o) => o.id === selectedIds[0]);
        if (!obj || obj.plotted)
            return;
        const next = change(obj);
        if (!next)
            return;
        remember();
        const objects = page.objects.map((item) => item.id === obj.id ? next : item);
        setPage({ ...page, objects });
        persist(page.id, objects);
    };
    const trimSelectedImage = (sides: TrimSide[]) => changeSelectedImage((obj) => trimImageBlankEdges(obj, sides));
    const resetSelectedImageTrim = () => changeSelectedImage(resetImageBlankEdges);
    const mapSelected = (fn: (t: Transform) => Transform) => {
        if (!page || selectedIds.length === 0)
            return;
        remember();
        const sel = new Set(selectedIds);
        const objects = page.objects.map((o) => sel.has(o.id) && o.transform ? { ...o, transform: fn(o.transform) } : o);
        setPage({ ...page, objects });
        persist(page.id, objects);
    };
    const fitSelected = () => {
        const b = selectionBounds();
        if (!b || !cal)
            return;
        const w = Math.max(b[2] - b[0], 0.001);
        const h = Math.max(b[3] - b[1], 0.001);
        const W = cal.plot_width, H = cal.plot_height;
        const factor = Math.min((W * 0.95) / w, (H * 0.95) / h);
        const gcx = (b[0] + b[2]) / 2, gcy = (b[1] + b[3]) / 2;
        // Scale in place around the selection's own center; shift only as far as
        // needed to keep the grown bounds on the sheet (no recentering).
        const nx0 = gcx + (b[0] - gcx) * factor, nx1 = gcx + (b[2] - gcx) * factor;
        const ny0 = gcy + (b[1] - gcy) * factor, ny1 = gcy + (b[3] - gcy) * factor;
        const dx = nx0 < 0 ? -nx0 : nx1 > W ? W - nx1 : 0;
        const dy = ny0 < 0 ? -ny0 : ny1 > H ? H - ny1 : 0;
        mapSelected((t) => {
            const next: Transform = {
                ...t,
                x: gcx + (t.x - gcx) * factor + dx,
                y: gcy + (t.y - gcy) * factor + dy,
                scale: (t.scale ?? 1) * factor,
            };
            if (t.scaleX != null)
                next.scaleX = t.scaleX * factor;
            if (t.scaleY != null)
                next.scaleY = t.scaleY * factor;
            return next;
        });
    };
    const centerSelected = () => {
        const b = selectionBounds();
        if (!b || !cal)
            return;
        const dx = cal.plot_width / 2 - (b[0] + b[2]) / 2;
        const dy = cal.plot_height / 2 - (b[1] + b[3]) / 2;
        mapSelected((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
    };
    const nudgeSelected = (dx: number, dy: number) => {
        if (!page || selectedIds.length === 0)
            return;
        const sel = new Set(selectedIds);
        const objects = page.objects.map((o) => sel.has(o.id) && o.transform
            ? { ...o, transform: { ...o.transform, x: o.transform.x + dx, y: o.transform.y + dy } }
            : o);
        setPage({ ...page, objects });
        persist(page.id, objects);
    };
    return { selectionBounds, objectLocalSize, setSelectedObjectPosition, setSelectedObjectSize, setSelectedObjectRotation,
        trimSelectedImage, resetSelectedImageTrim, mapSelected, fitSelected, centerSelected, nudgeSelected };
}
