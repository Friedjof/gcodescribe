# Interface refactoring: a full-window editor

Historical plan and implementation notes, 16 November 2026. Implementation follows the expanded request of that date, with an eight-hour implementation/validation window from 00:20 to 08:20 (Europe/Berlin).

## Backup and working branch

- Saved starting point: `698188a` on `main`.
- Recent changes are separate: `f5db2a7` for numeric inputs and `698188a` for the measurement bar.
- Backup tag: `interface-refactoring-base-2026-11-16`.
- New working branch: `interface-refactoring`; Git branch names cannot contain spaces.
- Last validated baseline: 442 frontend tests and a successful production build.
- Commit this plan separately on the working branch, then implement it in reversible steps.
- Inspect the baseline with `git switch --detach interface-refactoring-base-2026-11-16`; create a new branch to develop from it. Use `git revert <commit>` for individual later steps. Save local work before switching branches.

## Required direction from user feedback

1. Fill the entire window width and height.
2. Use a document-editor layout: actual tabs, compact command groups, docked panels, clear separators and a status bar.
3. Default to light, with optional dark mode. Keep white paper and legible drawings in both.
4. Give beginners a clear entry point and a reduced interface.
5. Allow workspace tabs to be hidden and reordered. Hide AI Designer, Font Editor and other specialist workspaces in the beginner preset.
6. Audit space usage: canvas padding, sidebars, cards, toolbars, minimum heights and fixed grid choices.

Implement directly in the app on the separate branch and validate using isolated browser profiles. Tests do not initiate unsolicited machine movement.

## Target layout

- **Top:** flat workspace tabs, a compact app name, printer status and a visible Stop plot action whenever a job is active.
- **Below:** menus and a compact command bar grouped into Edit, Insert, Arrange, View and Preview/Plot. Use clear names and consistent SVG icons.
- **Left:** a narrow toolbar and an optional docked project/pages panel for navigating pages and objects.
- **Centre:** a continuous neutral workspace with white paper, optional rulers and a measurement bar. Closing a panel immediately frees canvas space.
- **Right:** collapsible properties for the current tool, object type and selection. Put general actions such as Undo, clipboard and import in the command bar.
- **Bottom:** save status, page/selection, units, zoom and background tasks. Remove permanent information rows and floating zoom pills.

Workspace tabs switch app functions. Project pages stay in the pages panel or optional document tabs. Give these two navigation levels distinct styling and labels.

## Navigation and configurable tabs

### Beginner preset and order

**Start → Draw → Templates → Jobs → Setup**.

- **Start:** Insert image, Write text, Use template, Open project and a clear setup status.
- **Draw:** the existing designer with tools, pages, properties, measurements and preview.
- **Templates:** existing generative templates/games.
- **Jobs:** generated jobs, progress and results.
- **Setup:** guided access to connections, paper/plot bounds and pen calibration.

Additional workspaces: **Gallery, Profiles, Control, Font Editor and AI Designer**. These regroup existing features without discarding content.

### Managing tabs

- Offer Customise tabs through View and a clear button at the end of the tab bar.
- Use checkboxes for visibility; support dragging and keyboard-accessible up/down controls for ordering.
- Provide explicit Restore beginner preset and Show all workspaces presets.
- Keep hidden workspaces reachable through More workspaces, with an option to pin them again.
- Keep at least one available workspace visible. Hiding the active one selects a visible neighbour.
- Server configuration still controls AI availability; a UI preference cannot enable a disabled feature.
- Hiding a tab deletes no projects, jobs or drafts. Visited editors retain state and background work keeps a visible status.
- Use a controlled overflow menu when space is limited instead of compressing tabs until they are unreadable.

## Beginner workflow

The beginner interface changes information structure, labels and task guidance:

1. **Start:** choose a task instead of searching a long technical options list.
2. **Set up:** clearly display connection, paper and pen states and offer the next missing step as an action.
3. **Edit:** show selection, movement, sizing, text, shapes and import. Give lines/hatching understandable defaults and place detailed values under Advanced.
4. **Preview:** make inspection the primary next step before plotting. Keep G-code export reachable through File or the full interface.
5. **Plot:** require an explicit user command and retain existing profile, connection and safety checks.

Keep help next to the task. Progress and errors identify a concrete next action. Distinguish connected from ready to plot using existing state rules.

Guided and Full are display preferences. Switching them changes no calibration, moves no hardware and resets neither tab customisation nor documents. Stop plot remains reachable in every mode/workspace.

## Space and spacing audit

| Current area / constraint | Planned treatment |
| --- | --- |
| `.app`: centred, at most 1680 px / 97 vw, outer padding | Fill the window without an outer card border |
| `.paint`: 16 px gaps between main areas | Docked panels with simple separators and narrow splitters |
| `.card`: 16 px padding/radius, deep shadow | Continuous editor panels; appropriate spacing for dialogs and actual content |
| Fixed 360 px pages list | Approximately 220 px by default, adjustable and fully collapsible |
| Fixed 300 px properties panel | Approximately 260 px by default, adjustable and fully collapsible |
| 54 px toolbar plus gaps | Compact continuous bar with adequate hit targets |
| Canvas inset `max(W,H) * 0.04 + 4` in plot millimetres | Screen-pixel display padding separate from document margins; Fit paper, Fit selection and Maximise paper views; reachable edge handles |
| Canvas height `100dvh - 122px`, minimum 520 px | Flexible grid with `minmax(0, 1fr)`; bars determine their actual height, side panels scroll independently |
| Permanent profile/dimension information above the canvas | Compact bottom status, on-demand details and optional measurements |
| Floating zoom and task popup over the document | Status-bar zoom/tasks with expandable details |
| Fixed-only grid spacing | Retain presets and add validated custom input; separate visibility and snapping |
| Large generic button/input spacing | Comfortable and Compact densities, with visible focus and usable targets |

UI padding is a display preference. Paper/plot margins belong to calibration; grid spacing remains a document/editing setting. Full width does not remove physical plotter limits.

Use shared spacing tokens instead of exposing a setting for every pixel. Visible panels, widths, density, rulers, grid visibility and optional bars are the user-facing controls.

## Visual design

- Light neutral app chrome, white paper and restrained blue selection/focus.
- Shared semantic tokens for dark mode; portals, menus and dialogs inherit the theme.
- Flat tabs with an active underline or connection to content and limited rounding.
- One-pixel panel separators, small control radii and targeted menu/dialog shadows.
- System fonts, compact hierarchy, tabular measurement digits and restrained capitalisation.
- Consistent SVG icons instead of mixed emoji/symbols.
- Distinct focus, selection, error, disabled and working states; colour is never the only distinction.
- No new UI-library dependency is required.

## Technical boundaries

- `AppShell` owns the frame and slots for tabs, menus/commands, workspace and status.
- `workspaceRegistry` defines stable IDs, translations, ordering, availability, components and keep-alive rules.
- `interfacePreferences` stores versioned, validated preferences, accessed through `useInterfacePreferences`.
- `WorkspaceTabs`, `TabSettings`, `CommandBar`, `ToolbarGroup`, `DockPanel`, `SplitPane` and `StatusBar` are bounded UI building blocks.
- `BeginnerStart` and `SetupOverview` guide tasks using existing services/state.
- `styles/tokens.css` defines themes, density and spacing; keep shell/control styles separate from feature styles.
- Existing document, calibration, job and canvas controllers remain the domain interfaces. Views do not create another storage or printer-control layer.
- Keep display preferences separate from projects/printer settings. Safely discard unknown/obsolete saved tab IDs and retain sensible defaults.
- Account for active pointer gestures during layout/panel changes: no accidental geometry commits, unreachable handles or incorrect screen/plot coordinates.
- Remove old CSS rules as each area migrates rather than accumulating contradictory overrides.

## Implementation as separate commits

| Step | Result | Acceptance |
| --- | --- | --- |
| A. Shell and tokens | Full-window layout, default light/optional dark, compact controls | Dimensions and portals checked in both themes; existing views reachable |
| B. Tabs and preferences | Ordering, hiding/pinning, overflow, keyboard controls and reset | Hiding active tabs, server flags, restarts and unsaved editors checked |
| C. Docked designer | Adjustable/collapsible panels, continuous canvas, status bar, suitable padding | Window sizes, focus view, resizing and edge handles checked |
| D. Commands and properties | Shared actions above, contextual properties, optional dimensions, clear presets | Existing commands/Undo retained; no duplicate inputs or hidden actions |
| E. Beginner interface | Start, setup overview, guided editing and preview/plotting | A new user can find the next step; mode switching preserves work |
| F. Other workspaces | Apply the same design to templates, gallery, jobs, profiles, control and specialist editors | Consistent layout, focus, theme and navigation |

A step may contain several small commits. Record functional corrections separately. No implementation step automatically publishes a release.

## Validation criteria

- Browser/desktop windows at 1366×768, 1920×1080 and 2560×1440, plus narrow views and 125/150/200% scaling.
- No outer editor width cap or unnecessary horizontal page scrolling; visibly more canvas on large screens.
- Independently close/reopen pages and properties by keyboard; the canvas uses the freed width.
- Theme, density, panel and tab changes leave drawing dimensions unchanged.
- Persist tab order/visibility after restart and retain hidden-editor drafts.
- Keep numeric-input, Undo, autosave, navigation, calibration and print-start regressions passing.
- Preserve correct profile/connection/job states and Stop plot. A connected device is not automatically fully configured.
- Visually check both themes and critical combinations; before release, additionally test `.deb`/Flatpak installation/upgrades, physical operation and notifications.

## References

- [draw.io editor themes and modes](https://www.drawio.com/docs/manual/editor/appearance/): fixed panels, tabs and density variations.
- [draw.io canvas space](https://www.drawio.com/docs/manual/editor/increase-drawing-canvas/): hiding UI elements as needed.
- [Office ribbon tabs and command groups](https://support.microsoft.com/en-gb/office/foundations-experiences/customize-the-ribbon-in-office?appver=zsc900&helpid=76843&ns=onenote&syslcid=2057&uilcid=2057&version=90): familiar command grouping. This project's implementation is independently designed for the plotter.

## Implementation status

At this stage, work is on `interface-refactoring`; `main` and the backup tag are unchanged.

- Shell, actual workspace tabs, tab management and local layout preferences are implemented.
- The designer has optional adjustable pages/properties panels, white paper, rulers, a fixed zoom bar and adjustable paper padding. View changes write no geometry.
- Document actions are grouped in a shared menu bar. Beginner mode reduces permanently visible tools while keeping specialist tools reachable.
- Setup guides profile/project selection, connection, paper/pen, a first text page and a real G-code preview. Progress is saved per project and bound to its checked profile revision. Offline preparation remains distinct from complete machine setup.
- Beginner calibration shares the full view's controllers but shows one task at a time. Additional positions/obstacles are in an optional menu.
- Dialog focus and keyboard navigation prevent menu actions from triggering jog commands.

Interim validation: 485 frontend tests and the production build passed. Browser runs against an isolated local backend covered an existing profile, a new profile/project, offline entry, a first text page and the 3D path preview. No hardware access or print start. Further theme, layout, integration and package checks follow.

## Additional user corrections, 16 November

- Reduce clutter: a one-row toolbar, on-demand properties and more consistent SVG icons.
- Prioritise desktop. Setup/calibration must be accessible without scrolling. Remove duplicate Start/Setup areas and migrate saved Start tabs.
- Make the header more compact, with classic File, View, Tools and Help menus.
- Fully check tab customisation: a global horizontal flex rule incorrectly placed its introduction beside the list. Dialog bodies now default to vertical layout; specialised multi-column dialogs define that explicitly.
- Rebuild Templates around a left library, central preview and paginated right parameters, keeping Generate/Add visible.
- Scrolling exception: **the jobs list must scroll**, while its filters/actions stay fixed. Reuse preview data when switching list/tile views and load only visible thumbnails.
- Audit every feature/dialog for formatting, operation and clarity. Isolated browser checks do not move hardware.

At 1366×768, all four calibration tasks and all 14 templates fit without vertical/horizontal content overflow; tab customisation fits the window and 45 synthetic jobs have their own scroll area. A new template preview was generated. The full frontend run currently passes 499 tests; further feature/dialog review continues.

### Inline maps and reproducible random templates

- Templates now use a paginated library, a full-height paper preview, and a bounded properties pane. Parameter pages preserve their values; creation actions remain visible.
- OSM lives directly in that workspace. Place search, layer selection and drawing parameters have their own property tabs. Map changes debounce by 250 ms, cancel superseded requests, retain the last visible drawing, and reuse up to six recent results. Insertion requires a result matching current settings. Full route/3D analysis runs only on explicit request.
- Random templates have a permanent, explained five-digit random code (including Bingo), an explicit dice action, and repeatable Generate behavior. Codes are preserved as object metadata and shown in the drawing status. The font writing test also exposes and explains its variant code.
- Validation: production build passed; 505 frontend tests passed before the final object-metadata regression was added. Inline OSM checked in Firefox at 1366 × 768 with mocked map data: no dialog and no overflowing pane, including all layers and drawing settings. Real OSM network latency is external and was not benchmarked by this fixture.

### Final desktop review

The desktop review now covers the nine available workspaces (drawing, templates, gallery, jobs, setup, profiles, control, font editor and AI designer), rather than only the start screen.

| Area | Result |
| --- | --- |
| Desktop layouts | Firefox: 54 workspace/theme/viewport combinations at 1024 × 768, 1366 × 768 and 1920 × 1080; no overflowing main panes or uncaught JavaScript errors in those checks. |
| Setup | New-profile form, connection, all four calibration tasks, first-page and preview tasks fit at 1024 and 1366 pixels. Connected control rendering used simulated GET responses; all writes/motion requests were blocked and none were attempted. |
| Templates / random code | All 14 templates checked. The same five-digit code reproduced identical preview paths, and code 54321 remained visible after creating a canvas page. Mandala and pattern styles now use named choices that fit the inspector. |
| OSM | Inline place/content/drawing tabs; matching-result insertion, cancellation and bounded cache tested. Local map fixtures were used; external OSM service latency remains outside this UI benchmark. |
| Jobs | Collection retains vertical scrolling. Six list/tile switches with 45 local test jobs reached the next painted view in 19–29 ms. Heavy path conversion is bounded/cached. Replaced or closed 3D previews cannot be reopened by late responses. |
| Other dialogs | All profile and settings groups, writing-test playback/alignment, font/symbol collections, project settings, STL parameter pages and gallery item details checked. Confirmation and text prompts now share modal focus and Escape ownership. |
| AI | Local fake generation → saved gallery item → detail view succeeded. No paid/external AI request was made. |
| Development | Polling-based Vite startup succeeded in 110 ms on a separate test port; HTML and current styles returned HTTP 200. The full interactive make launcher was not used because it may manage existing user services. |
| Automated checks | 516 frontend tests passed; 1019 Python tests passed after the captured-project fix; Ruff passed. Production build passed. Vite still reports its existing advisory for a main chunk larger than 500 kB. |

Template insertion now captures the target project and expected profile fingerprint. A parallel project switch cannot redirect the page, and a changed target profile is rejected. Creating a page in a different project also preserves the currently active project's page selection.

The retired generated-template dialog, duplicate manual/automatic seed wiring and 53 obsolete dialog/layout rules have been removed. Feature layouts and bounded collection components live in separate modules; no dependencies were added. Changes are saved as separate commits on `interface-refactoring`; the original main branch and the rollback tag remain available.

Physical serial/OctoPrint motion and installed DEB/Flatpak notification delivery were not exercised by these UI fixtures. Existing desktop-notification regression tests passed (7 tests, also part of the Python suite). This pass does not publish a new release or claim a real printer test.

### Guided tour, visual finish and fine drawing lines

- A replayable 11-step tour now highlights the actual profile, connection,
  calibration, first-page, preview, drawing and template controls. First-time
  setup offers it automatically; Help → Guided tour opens it later. Back, Next,
  minimize, resume and saved progress keep it optional. Tour completion does not
  certify machine setup: returning to setup restores the real pending task.
- The overlay yields to settings, dialogs and printer activity. Real actions
  underneath remain usable; locked calibration steps retain their prerequisites.
  Manually switching tabs minimizes the tour. Temporarily revealing a hidden
  workspace does not change the user's saved tab preferences.
- The editor has quieter nested borders, consistent menu/dialog elevation,
  subtle paper shadow, a teal studio accent and short transitions. Reduced-motion
  preferences disable the decorative movement. Desktop density is preserved.
- Drawing ink now stays at 0.9 CSS pixels through zooming, mirroring and unequal
  object scales. The grid also keeps a stable screen width. Drafts, live scenes
  and shared previews use the same display width. Large drawings switch from a
  bounded bitmap to exact vector detail before the bitmap would be enlarged.
  Source geometry, eraser edit radius, pen settings and generated G-code are
  independent of this display correction.

Validation: 528 frontend tests passed; the final production build passed. The
tour completed at 1024×768 and 1366×768 without overflowing panes or cards. An
additional dark/reduced-motion browser run used real clicks to confirm a profile,
open/close settings, switch tabs and resume; hidden-tab preferences survived and
no write/motion request was attempted. A dense 52,250-point drawing exercised
bitmap/vector switching at high zoom; saved source geometry stayed identical.
The 54 workspace/theme/viewport combinations were checked again with the new
visual styles: no overflowing main panes or uncaught JavaScript errors.
The previous Python/Ruff checks still apply because this pass changes only the
frontend. Physical printer and installed DEB/Flatpak checks remain outstanding.

### Zoom continuity follow-up

Wheel zoom and panning previously forced the bounded loading sample even after
the full vector path was ready. That sample skipped entire strokes above 1,000
polylines and reduced points on detailed curves. Pending bitmap refreshes also
selected that sample, causing visible detail loss during navigation.

Navigation now reuses the complete cached vector path, including while a bitmap
is being refreshed or replaced by vector detail. A gesture that starts before
background preparation finishes builds and caches the complete path once. The
bounded sample is reserved for initial loading before a gesture, never used to
downgrade a prepared drawing. No geometry or undo entries are changed by zooming.

Validation: 532 frontend tests passed and the production build passed. New
regressions cover many separate strokes, detailed curves, repeated wheel events,
panning and a gesture before worker completion. Firefox used real wheel and
right-drag actions on 2,400 strokes and a 52,000-point/2,600-stroke drawing. Across
167 captured animation frames there was no incomplete vector fallback, no
uncaught JavaScript error and no write/motion request. Saved geometry stayed
identical. Dense drawings are still constrained by available display pixels at
fit-to-page scale; zoom reveals their full detail without deliberate omission.

### Unified profile editor

Profiles now opens in Visual mode: the same calibration wizard, arrow pad and
live preview operate on the selected profile. Details keeps the numeric overview.
Switching from unsaved details requires an explicit save; pending movement tests
block switching into manual control. Setup and the tour open the project profile
in this editor rather than hosting a second calibration workspace.

Profile requests carry an explicit target. Inactive profiles can be viewed and
edited without changing the project or the global active profile. Direct printer
commands require the selected profile to be active; backend guards also enforce
this if activation changes after the UI loaded. XML import/export and frame
patterns use the selected profile too.

The visual snapshot is read atomically from
`GET /api/profiles/{id}/calibration-state`. A running older backend on port 8010
was observed ignoring `profile_id` on the old paper endpoint, producing a false
conflict for inactive profiles. Older servers now fall back to the selected
profile's read-only preview, with commands disabled instead of accidentally
writing global calibration. Details remains available. Python dev reload uses
polling by default on the next `make dev` start.

Validation: full frontend run (547 tests), followed by focused tests for the
pending movement-test guard and old-server preview (55 tests). Production build,
Ruff and shell syntax passed. Full backend run covered 1,029 tests; four vpype
conversion failures were caused by PATH selecting an incomplete user install and
passed when rerun with `.venv/bin` first (12 conversion tests). The final atomic
snapshot addition passed the 101-test profile/context subset. Browser checks
covered both themes at 1024×768, 1280×720 and 1366×768, all four calibration steps,
view switching, isolated profile writes and all 11 tour steps. An inactive profile
was also opened on the actual old dev backend: preview and wizard visible, no
conflict, no write request. No physical printer movement was performed.

### Setup project selection: consistent calibration reads

The running development server returned `defined_positions: []` from the selected
profile but `["park", "calibration"]` from its paper endpoint. Coordinates and
profile fingerprints matched. Comparing these representations therefore blocked
Setup with a false concurrent-change error.

The shared project store now derives the paper outline from its single profile
response. Automatic-position metadata stays intact; project identity, fingerprint
checks and cancellation of superseded reads remain in place. The existing
read-only profile fallback shares this geometry helper. Load retry buttons now
say “Reload” instead of “Retry saving”.

Regression coverage includes the observed legacy metadata discrepancy, delayed
responses during project changes, shared polling and degenerate paper outlines.
The production build passed. Firefox loaded Setup against the affected server
without an error, then completed seven simulated selector changes using its real
profile data. No global paper reads, JavaScript errors or actual writes occurred;
the background refresh also retained a consistent selection.
