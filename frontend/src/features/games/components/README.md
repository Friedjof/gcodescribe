# Template workspace components

- `TemplateLibrary.tsx` provides the category filter, paginated template selection and STL entry point.
- `GameSettingsPanel.tsx` renders controlled parameter pages. The workspace owns generation, page creation and the permanent random-code control.
- `PreviewSvg.tsx` renders the paper preview shared by templates and inline OSM maps.
- `../hooks/useTemplateSeeds.ts` keeps one explicit, reproducible five-digit code per random template. `components/SeedControl.tsx` supplies its explanation, input and dice action.
- OSM-specific request cancellation, bounded caching and current-result checks live in `features/osm/hooks/useOsmPreview.ts`; map properties are rendered inline by `features/osm/OsmMapEditor.tsx`.

The former generated-template popup and its hidden manual/automatic seed controls have been retired.
