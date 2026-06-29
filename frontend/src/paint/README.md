# `src/paint`

Pure domain logic for the drawing editor — no React components, no direct API
calls. Everything here is either a pure function or a React hook that depends
only on other files in this directory.

```
paint/
├── geometry.ts          Core 2-D math: Point/Transform types, coordinate
│                        transforms, bounding boxes, snap helpers, path
│                        simplification, alignment guides
│
├── eraser.ts            Eraser geometry extracted from Paint.tsx / PaintCanvas.tsx
│                        (was duplicated in both). Exports:
│                          EraserBrush, ERASER_BRUSH_FACTOR
│                          pointSegmentDistance, segmentsDistance
│                          lineNearPath, segmentNearPath
│                          eraseLinePieces, eraseWorldPolylines, samePolylines
│
├── viewTransform.ts     View/canvas transform math extracted from PaintCanvas.tsx.
│                        Exports:
│                          ViewRotation (0|90|180|270), ResizeEdge
│                          rotatePoint, rotatedBounds, normalizeDeg
│                          signedDeg, displayDeg, snapRotation
│                          worldPoint, screenVectorToRotatedLocal, resizeLocals
│
├── useObjectOps.ts      React hook — all object editing operations extracted from
│                        Paint.tsx. Owns undo/redo stacks, clipboard, draft-text
│                        state. Exports the ObjectOps interface and useObjectOps().
│
├── masks.ts             Mask-object detection and polygon-subtraction helpers
│                        (isMaskObject, maskPolygon, subtractPolygon)
│
├── sceneObjects.ts      Scene-object helpers: basePolylines, cloneObjects,
│                        objectStyle, textGeometryAsync, withStyledCache, zValue
│
├── styling.ts           VectorStyle types and stroke/fill polyline builders
│
├── text.ts              Text-to-polylines rendering; TextFont, TEXT_FONTS
│
├── SceneView.tsx        SVG renderer used by the live-stream viewer
│
├── insertAsset.ts       Helper for inserting gallery items as scene objects
│
├── coloring.ts          Per-stroke colour assignment logic (coloring editor)
│
└── *.test.ts            Vitest unit tests (alignment, coloring, insertAsset, masks)
```

## Design rules

- No file in this directory may import from `../components/*`.
- `geometry.ts` has no dependencies within the project.
- `eraser.ts` and `viewTransform.ts` depend only on `geometry.ts`.
- `useObjectOps.ts` may import other files in this directory but not React
  components.
