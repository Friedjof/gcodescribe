# Drawing editor components

`Paint.tsx` connects these views to the document, canvas and job controllers.
Scene changes go through `ObjectOps`; local component state is limited to input
drafts and display preferences.

- `PaintPrecisionBar.tsx`: optional exact measurements above the canvas. X/Y
  describe the top-left of the rotated bounding box; width and height describe
  the unrotated object. Supports one selected object, linked proportions and
  rotation. Expansion is remembered locally. Inputs are keyed by selection;
  the parent also keys the component by page.
- `PaintStylePanel.tsx`: stroke and fill properties in the right inspector.
- `FillOptions.tsx`: shared pattern, angle and spacing controls for object
  fills and fill-tool defaults.
- `PaintTextPanel.tsx`: text content, font and committed font-size input.
- `PaintImageModal.tsx`: image conversion mode and detail before import.
- `canvas/`: SVG layers, transform handles and live gesture feedback.
- `SceneView.tsx`: scene renderer also used by the live-stream viewer.

Numeric fields use `CommittedNumberField` in decimal-input mode. Typing and
arrow-key adjustments stay local until Enter or blur. Escape restores the
applied value. Commas, decimal points and matching unit suffixes are accepted;
ambiguous thousands separators and expressions are rejected. An external value
change discards a stale draft with an explanation.

`lib/objectMeasurements.ts` owns measurement interpretation and exact-transform
validation. Numeric edits reuse the canvas plot-boundary helper. A fitting edit
may shift the object into the plot, preserving its exact dimensions; an edit
that would require shrinking the requested dimensions is rejected. Successful
changes create one undo entry, while unchanged and invalid values create none.
