import { describe, expect, it } from "vitest";
import type { GalleryItem, GalleryPreview, GallerySvg, Source, SourcePreview } from "../api";
import {
  fitScale,
  galleryItemObject,
  galleryPageObject,
  imageObject,
  sourcePlacementObject,
} from "./insertAsset";

const cal = { plot_width: 200, plot_height: 100 };

describe("fitScale", () => {
  it("never upscales a small drawing", () => {
    expect(fitScale(10, 10, cal)).toBe(1);
  });
  it("fits a large drawing to ~90% of the limiting axis", () => {
    // height-limited: 100*0.9 / 200 = 0.45
    expect(fitScale(400, 200, cal)).toBeCloseTo(0.45);
  });
});

describe("imageObject", () => {
  it("centres the object in the plot area and stores base polylines", () => {
    const local = [[[-1, -1], [1, 1]]] as any;
    const obj = imageObject(local, 0.5, { galleryId: "g1", name: "x" }, cal);
    expect(obj.type).toBe("image");
    expect(obj.transform).toMatchObject({ x: 100, y: 50, rotation: 0, scale: 0.5 });
    expect(obj.data).toMatchObject({ galleryId: "g1", name: "x", basePolylines: local });
    expect(obj.cachedPolylines).toBe(local);
    expect(obj.plotted).toBe(false);
    expect(typeof obj.id).toBe("string");
  });
});

describe("galleryItemObject", () => {
  const svg: GallerySvg = { polylines: [[[0, 0], [40, 20]]], width: 400, height: 200 };
  it("uses the title as name and fits to the plot area", () => {
    const item = { id: "g1", title: "Mein Bild", filename: "foo.svg" } as GalleryItem;
    const obj = galleryItemObject(item, svg, cal);
    expect(obj.data).toMatchObject({ galleryId: "g1", name: "Mein Bild" });
    expect(obj.transform!.scale).toBeCloseTo(0.45);
  });
  it("falls back to the filename (without extension) when there is no title", () => {
    const item = { id: "g2", title: "", filename: "rocket.png" } as GalleryItem;
    expect(galleryItemObject(item, svg, cal).data!.name).toBe("rocket");
  });
});

describe("galleryPageObject", () => {
  const preview: GalleryPreview = {
    polylines: [[[10, 10], [50, 30]]],
    bounds: [10, 10, 50, 30], // 40×20 content within a larger page
    width: 60,
    height: 40,
  };
  it("fits by content bounds and tags the page when multi-page", () => {
    const item = { id: "g1", title: "Doku", filename: "doc.pdf", pages: [{}, {}] } as GalleryItem;
    const obj = galleryPageObject(item, preview, 2, cal);
    // content is 40×20 → height-limited fit: 100*0.9 / 20 capped at 1
    expect(obj.transform!.scale).toBe(1);
    expect(obj.data).toMatchObject({ galleryId: "g1", galleryPage: 2, name: "Doku · S.2" });
  });
  it("keeps the plain name for single-page assets", () => {
    const item = { id: "g2", title: "Bild", filename: "x.svg", pages: [{}] } as GalleryItem;
    expect(galleryPageObject(item, { ...preview, bounds: null }, 1, cal).data!.name).toBe("Bild");
  });
});

describe("sourcePlacementObject", () => {
  const source = { id: "s1", name: "plan.pdf" } as Source;
  const preview: SourcePreview = {
    polylines: [[[0, 0], [50, 25]]],
    bounds: [0, 0, 50, 25],
    width: 50,
    height: 25,
  };
  it("scales by target width / content width and strips the extension", () => {
    const obj = sourcePlacementObject(source, preview, 100, cal);
    expect(obj.data).toMatchObject({ sourceId: "s1", name: "plan" });
    expect(obj.transform!.scale).toBeCloseTo(2); // 100 / 50
  });
  it("uses preview.width when bounds are absent", () => {
    const obj = sourcePlacementObject(source, { ...preview, bounds: null }, 25, cal);
    expect(obj.transform!.scale).toBeCloseTo(0.5); // 25 / 50
  });
});
