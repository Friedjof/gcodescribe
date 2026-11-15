import type { Calibration, Page, SceneObject } from "../../../api";
import { retainPage } from "../../../api/pageEdits";
import { useI18n } from "../../../i18n";
import { useToasts } from "../../../components/Toasts";
import { localize, transformPolylines, type Pt, type Transform } from "../lib/geometry";
import type { TextFont } from "../lib/text";
import { randomTextSeed, textGeometryAsync } from "../lib/sceneObjects";
import { DEFAULT_VECTOR_STYLE, type FillStyle } from "../lib/styling";
import { bucketFillRegion } from "../lib/bucketFill";
import { fitPageObjects } from "../lib/fitPage";
import type { ObjectOps } from "./useObjectOps";

export function usePaintCanvasActions({ page, cal, pageBlocked, fillStyle, ops, setPage,
  persist, setPlotError, defaultText, warnMissingGlyphs, fail }: {
    page: Page | null; cal: Calibration | null; pageBlocked: boolean; fillStyle: FillStyle;
    ops: Pick<ObjectOps, "addObject" | "remember">;
    setPage: React.Dispatch<React.SetStateAction<Page | null>>;
    persist: (id: string, objects: SceneObject[]) => void;
    setPlotError: (message: string | null) => void;
    defaultText: string; warnMissingGlyphs: (missing: string[]) => void; fail: (error: unknown) => void;
  }) {
  const { t } = useI18n();
  const toast = useToasts();
  // Both fill tools produce a normal closed object with fill.enabled, so the
  // existing style/render/G-code pipeline (withStyledCache → buildStyledPolylines
  // → hatchFill) turns it into plottable hatch lines with no backend changes.
  // Guard against degenerate/empty polygons: an empty localize() yields NaN
  // centers, which serialise to null and crash the backend's transform math.
  const makeFillObject = (polygonWorld: Pt[][]): SceneObject | null => {
    const { local, cx, cy } = localize(polygonWorld);
    if (!local.some((line) => line.length >= 2) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return {
      id: crypto.randomUUID(),
      type: "fill",
      data: { basePolylines: local, style: { ...DEFAULT_VECTOR_STYLE, fill: { ...fillStyle, enabled: true } } },
      transform: { x: cx, y: cy, rotation: 0, scale: 1 },
      plotted: false,
    };
  };

  const handleBucketFill = (at: Pt) => {
    if (!page || !cal) return;
    const world = page.objects
      .filter((o) => !o.plotted)
      .flatMap((o) => transformPolylines((o.cachedPolylines ?? []) as Pt[][], o.transform ?? { x: 0, y: 0, rotation: 0, scale: 1 }));
    const poly = bucketFillRegion(world, at, cal.plot_width, cal.plot_height);
    const obj = poly && makeFillObject([poly]);
    if (!obj) { toast.error(t("paint.bucketFillFailed")); return; }
    ops.addObject(obj);
  };

  const handleAreaFill = (polygonWorld: Pt[]) => {
    if (polygonWorld.length < 3) return;
    const obj = makeFillObject([polygonWorld]);
    if (!obj) { toast.error(t("paint.bucketFillFailed")); return; }
    ops.addObject(obj);
  };

  const fitDrawing = () => {
    if (!page || !cal || pageBlocked) return;
    const objects = fitPageObjects(page.objects, cal.plot_width, cal.plot_height);
    if (!objects) return;
    ops.remember();
    setPage({ ...page, objects });
    persist(page.id, objects);
    setPlotError(null);
  };

  const updateObject = (id: string, transform: Transform) => {
    if (!page) return;
    const objects = page.objects.map((o) => (o.id === id ? { ...o, transform, plotted: false } : o));
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const updateObjects = (updates: Map<string, Transform>) => {
    if (!page || updates.size === 0) return;
    const objects = page.objects.map((o) => {
      const transform = updates.get(o.id);
      return transform ? { ...o, transform, plotted: false } : o;
    });
    setPage({ ...page, objects });
    persist(page.id, objects);
  };

  const addTextObject = (at: Pt) => {
    if (!page) return;
    const release = retainPage(page);
    const text = defaultText;
    const size = 12;
    const font: TextFont = "sans";
    const seed = randomTextSeed();
    textGeometryAsync(text, size, font, defaultText, false, seed)
      .then(({ local, cx, cy, feeds, missing }) => {
        if (missing?.length) warnMissingGlyphs(missing);
        ops.addObject({
          id: crypto.randomUUID(),
          type: "text",
          data: { text, mode: "single-line", size, font, seed, basePolylines: local, style: DEFAULT_VECTOR_STYLE },
          cachedPolylines: local,
          cachedFeeds: feeds,
          transform: { x: at[0] + cx, y: at[1] + cy, rotation: 0, scale: 1 },
          plotted: false,
        });
      })
      .catch(fail).finally(release);
  };

  return { handleBucketFill, handleAreaFill, fitDrawing, updateObject, updateObjects, addTextObject };
}
