# `src/components/paint`

Sub-components of the drawing editor, extracted from `Paint.tsx` to keep that
file focused on orchestration. Each component is pure (no internal state beyond
controlled props).

```
components/paint/
├── PaintImageModal.tsx   Image-import dialog. Lets the user pick a conversion
│                         mode (edges / hatch / lines / dots / handwriting) and
│                         detail level before inserting a rasterised image as
│                         pen-plotter strokes. Props: file, mode, detail,
│                         importing, onModeChange, onDetailChange,
│                         onCancel, onImport.
│
├── PaintStylePanel.tsx   Right-side style inspector: object size (w/h with
│                         aspect-ratio lock), rotation, stroke mode/dash/dot
│                         settings, fill mode/angle/spacing. All state is
│                         lifted — the panel only fires callbacks.
│
└── PaintTextPanel.tsx    Text-object editor strip shown below the canvas when
│                         a text object is selected. Exposes a textarea for
│                         live input (debounced via onTextInput) and controls
│                         for font family and size.
```

## Conventions

- All components accept only controlled props — no `useState` internally.
- They import types from `../../api` and helpers from `../../paint/*`.
- `PaintImageModal` exports the `ImageMode` union type used by `Paint.tsx`.
- `PaintStylePanel` exports the `SelectedObjectSize` interface used by the
  parent to pass pre-computed size data.
