// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SceneObject } from "../../../../api";
import ObjectsLayer from "./ObjectsLayer";
vi.mock("../../hooks/useGeometryPath", () => ({
  useGeometryPath: () => "M0 0L10 10",
}));
vi.mock("../../hooks/useGeometryRaster", () => ({
  rasterGeometry: () => false,
  useGeometryRaster: () => ({ image: null, failed: false }),
}));
afterEach(cleanup);
it("keeps fine ink on mirrored and non-uniformly scaled objects while retaining source geometry", () => {
  const object: SceneObject = {
    id: "line",
    type: "line",
    cachedPolylines: [
      [
        [0, 0],
        [10, 10],
      ],
    ],
    transform: {
      x: 10,
      y: 10,
      scale: 1,
      scaleX: -4,
      scaleY: 0.25,
      rotation: 0,
    },
  };
  const before = JSON.stringify(object);
  const { container, rerender } = render(
    <svg>
      <ObjectsLayer objects={[object]} selectedIds={[]} stroke={0.2} />
    </svg>,
  );
  const path = container.querySelector("path")!;
  expect(path.getAttribute("stroke-width")).toBe("0.9");
  expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  rerender(
    <svg>
      <ObjectsLayer
        objects={[object]}
        selectedIds={[object.id]}
        stroke={0.01}
      />
    </svg>,
  );
  expect(path.getAttribute("stroke-width")).toBe("0.9");
  expect(JSON.stringify(object)).toBe(before);
});
