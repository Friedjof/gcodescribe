# `src/styles`

All CSS for the application. Loaded via a single entry point:

```
src/styles.css   @import chain — lists every file below in load order
```

## Files

```
styles/
├── base.css          CSS custom properties (design tokens), resets,
│                     typographic base, shared utility classes
│
├── layout.css        App shell: desktop/mobile layout, top navigation bar,
│                     tab content areas, cards, banners, shared form elements
│                     (buttons, inputs, select, badges, scrollbars)
│
├── toasts.css        Toast notification stack
│
├── modals.css        Generic Modal component and shared modal animations
│
├── control.css       Plotter control UI: Segmented control, jog pad, Z-height
│                     panel, iOS-style switch, offline state, wizard steps,
│                     paper calibration (corner chips, bed-size row, collapsible),
│                     calibration profiles panel
│
├── jobs.css          Jobs page: toolbar, search, list view (indented groups,
│                     colour-dot clusters), tile view (thumbnails, tile actions,
│                     colour-group tiles), selection checkbox, delete dropdown,
│                     obstacle/no-go zone editor, plotted badge
│
├── games.css         Games catalog: hero section, game grid, detail sidebar,
│                     badge row, settings panel (seed input, complexity slider,
│                     maze-type selector, coloring-pattern selector, visibility
│                     toggle), chip grid, auto-fit panel, generate button
│
├── games-modal.css   Games preview modal, OSM map editor modal and its
│                     controls/layer grid, responsive breakpoints for both
│
├── paint.css         Drawing editor layout: page sidebar, editor area, toolbar,
│                     grid/snap controls, split-button, profile banner, workspace
│                     grid, tool panel (icon grid, asset row, action buttons),
│                     style panel (size fields, aspect-ratio lock, stroke/fill
│                     controls)
│
├── paint-canvas.css  Canvas area: canvas wrapper, empty-page hint, zoom
│                     controls, plottability score chip + hover panel,
│                     SVG element, object panel, context menu,
│                     image-import modal + mode picker, responsive overrides
│
├── gallery.css       Gallery page: full-width grid, item cards, uploader chips,
│                     gallery popup (designer insert), drag-over state,
│                     gallery detail view
│
├── gallery-extras.css  Markdown editor, printer-backend switcher, serial-port
│                       discovery hint, gallery upload access dialog (QR link,
│                       secret row), upload locked state
│
├── ai.css            AI image generation view
│
└── settings.css      App settings page
```

## Load order matters

`control.css` defines `.seg` and `.switch` used by many other files.
`modals.css` defines the `modal-pop` keyframe animation referenced in
`jobs.css` (delete dropdown).  Always keep `control.css` and `modals.css`
before the feature stylesheets.
