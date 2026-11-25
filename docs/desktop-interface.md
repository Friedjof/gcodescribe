# Desktop interface and diagnostics

The GTK/WebKit desktop wrapper reads the Linux color scheme through libadwaita.
New desktop preferences use **System**. The small sun/moon button beside Settings
switches between light and dark; **View → Appearance → System** restores automatic
selection. Existing explicit theme preferences are retained. Desktop labels do
not select text; editable controls and readonly copy fields do.

The saved-printer selector, language selector, Settings and the theme button are
grouped in that order. Server and authentication settings are hidden in desktop mode. Fonts are
managed in the Fonts workspace, which combines the editor and font library.
An open font cannot be deleted from the library until it is closed in the editor.

Background tasks can be minimized to a small bell. Its counter includes running
and completed entries; the tooltip separates active, completed and failed tasks.
Opening the bell restores the task list and its dismiss-all action.

The square pen button in the designer confirms homing and travel to the current
project's calibration position and saved insertion-pressure offset. A rejected movement never advances to insertion.
After the command is accepted, the illustrated instructions explicitly require
waiting for the holder to stop before fitting the pen against the build plate.
Changing project, profile, page or printer retires that dialog.

Large G-code previews independently remember travel visibility and profile
outline visibility. Yellow marks the captured paper, green the drawing area.
Saved jobs prefer their calibration snapshot; legacy jobs without calibration
metadata do not display an unrelated current profile outline.

The STL importer displays its controls together in the left pane. Orbit keeps the
view upright, Trackball rotates freely over a virtual sphere, and CAD uses the
middle mouse button to rotate (Shift + middle or right mouse pans). Wheel zoom
works in all modes. The selected mode persists. Trackball roll is included in the
technical drawing and gallery parameters. Reset restores the isometric view.

## Keyboard shortcuts

Implemented workspace navigation follows the configured order of enabled
workspaces, including entries in the overflow menu:

| Shortcut | Action |
| --- | --- |
| Ctrl+Tab | Next workspace; wrap after the last workspace |
| Ctrl+Shift+Tab | Previous workspace; wrap before the first workspace |
| Left/Right, Home/End while a workspace tab has focus | Navigate the displayed tab strip |

The selected workspace tab receives keyboard focus. Text fields also allow
Ctrl+Tab; plain Tab and Shift+Tab retain their normal focus behavior. Modal
dialogs, open menu items, composition input and printer-switch transitions keep
control of their keys. Disabled or unavailable workspaces are excluded. The help
popup lists the new shortcuts in English, German, Bavarian, French and Spanish.
The desktop wrapper forwards both combinations in GTK's capture phase: native
`ISO_Left_Tab` otherwise gets consumed as focus traversal before reaching WebKit.
Forwarded events target the focused element and use the same frontend scope and
composition checks as browser keyboard events.
In a normal browser, Ctrl+Tab may be reserved for browser tabs before the page
receives the event; the app's tab strip remains keyboard accessible with arrows.

Validation combines unit tests, the production build and Ruff with native XTest
key events in the Flatpak WebKit runtime. Native checks cover settings/help,
text selection, zoom, selection, sidebar, rename, save, preview, SVG/JSON export,
creation, workspace aliases and font save/export. Drawing geometry stayed
unchanged and the test reported no JavaScript errors. The release workflow also
runs the complete backend and frontend suites in a clean checkout.

### Commands available in v0.6.3

Bindings follow the [GNOME shortcut conventions](https://developer.gnome.org/hig/reference/keyboard.html),
with context appropriate to autosaved slides, fonts and plotter output.

| Shortcut | Behavior |
| --- | --- |
| Ctrl+, | Open Settings |
| F1 / Ctrl+? | Open the localized shortcut and gesture reference |
| Ctrl++ / Ctrl+- / Ctrl+0 | Zoom in/out or fit the active canvas; supported in Draw, glyph editing, writing preview, Coloring and 3D views |
| Ctrl+A / Ctrl+Shift+A | Select/deselect drawing objects or all strokes of the active glyph; text fields retain native selection |
| Ctrl+S | Finish pending text rendering and flush Draw autosave, or save the current font/glyph |
| Ctrl+N | Create a slide in Draw; focus the new-font name field in the font editor |
| Ctrl+Shift+N | Open the new-project form |
| Ctrl+O | Open the project overview or the font list, according to the active editor |
| Ctrl+Shift+E | Open the SVG/JSON export chooser in Draw, or save and export the open font as .gcsfont |
| Ctrl+P / Ctrl+Shift+P | Open plot options / 3D preview in Draw; keyboard activation alone never starts a printer |
| Ctrl+F | Focus the slide search, project-overview search or current font's glyph search |
| F2 | Rename a focused slide/folder/project or the open font |
| Ctrl+PageDown / Ctrl+PageUp | Next/previous workspace, with the same order as Ctrl+Tab |
| Alt+1–8 / Alt+9 | Select a workspace by configured position / select the last workspace |
| F9 | Toggle the Draw slide sidebar or the font glyph sidebar |

Menu commands and keyboard shortcuts share a dispatcher. A deeper visible editor
has priority over application fallbacks regardless of lazy-loading order. The
foremost modal owns its commands; background editors, disabled controls, IME
composition and already handled events are respected. Holding document-creation
keys does not create repeated slides. Zoom keys may repeat.

Existing Draw shortcuts retain copy/cut/paste, Ctrl+D for duplicate,
Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y for undo/redo, Delete, arrow nudging and Escape. The font
editor retains D/E/M/P for draw, erase, move and playback. Coloring retains
undo/redo and Space for temporary pan. Ctrl+Q quits the desktop app.

Drawing exports retain physical SVG dimensions and visible mask ordering, or the
complete slide and calibration in JSON. Font export saves pending glyph changes
first. Renaming and export also have visible actions in the font editor header.
The 3D preview uses modal semantics and focus trapping so shortcuts cannot edit
a drawing behind it.

Ctrl+W does not delete slides or hide permanent workspaces. Global reload is not
bound while editing. Alt+Tab, Alt+F4, Super combinations and desktop workspace
switching remain with the operating system. Normal browsers may reserve some
bindings before the app receives them; all commands retain visible UI actions.

## Canvas navigation and visibility

Paper stays white and drawing ink stays dark in both interface themes. Dense
drawings prepare their bitmap in that ink color directly; no SVG image color
filter runs during navigation. A preview is decoded before it replaces the
previous image, and the complete vectors stay visible until the SVG image has
loaded. Image errors restore the vector fallback.

Navigation textures are capped at 2048 pixels per edge, reducing the maximum
texture area by 75% compared with the previous 4096-pixel cap. Small resting zoom
adjustments reuse the prepared image while cosmetic stroke width stays within
10% of its target. Wheel notches less than 250 ms apart share a gesture, avoiding
repeated vector/bitmap switches between notches. At rest, precise vectors return
when the bitmap would be enlarged. None of these display choices changes saved
geometry or printer toolpaths.

Visibility, native wheel input and image-resource cleanup are checked in the
Flatpak WebKit runtime using isolated data. Software rendering under Xvfb and
variable host load do not establish a guaranteed frame rate on every desktop.

## Printer diagnostics

Each saved printer has a connection test; testing does not change the selection
or save settings. OctoPrint reports server reachability, API access and its
physical printer connection separately. A reachable OctoPrint with state Closed
is not reported as a connected printer.

Serial testing first checks the path, permissions and existing connection.
Opening an unused port to request firmware identification requires a separate
confirmation because it can reset the controller. The test refuses an owned port
or an active job and holds the runtime transition lock during a probe so a new
job or selection cannot race it.

## Desktop MCP

Enable MCP and create a token in Settings → MCP. Copy the endpoint and token into
the client. The app must be running. Desktop requests require a bearer token,
loopback source address and, when supplied, a matching Origin. There is no login
bypass for MCP. Transport is stateless JSON HTTP; notifications receive 202 and
SSE GET requests receive 405.

The desktop port is stored in `desktop-endpoint.json` inside the application data
directory. Restarts reuse it, including immediately after a connection closes.
An occupied port produces a startup error instead of silently changing the MCP
address. The backend always binds to `127.0.0.1` in desktop mode.

Validation used the GTK4/WebKit6 runtime from the Flatpak SDK, fresh application
data and no configured physical printers. The official Python MCP SDK initialized,
listed 30 tools and called `get_mcp_overview` before and after a backend restart at
the same URL. The native setup tour, theme updates, Codex device-code login link
and cancellation were also exercised. The Fonts library and STL controls were visually checked in WebKit; all STL options fit the left pane at 1400 × 900. No account login or paid generation ran.

The final desktop smoke check switched all five languages and verified the header order. The README rendered with GitHub Markdown has two screenshots followed by three, with no broken images.

Final validation: 1,210 backend tests, 620 frontend tests, TypeScript/Vite production build, Ruff and `git diff --check` passed. Backend commands used the project virtual environment on `PATH`, including its vpype executable.

## Zoom measurement

A synthetic 256,000-point drawing was rendered with the original and changed
ObjectsLayer in the same WebKit runtime under Xvfb. Across 45 wheel frames:

| Renderer | Mean frame interval | Slowest interval |
| --- | ---: | ---: |
| Original | 37.0 ms | 149 ms |
| Retained raster without SVG mask | 32.9 ms | 52 ms |

These are development measurements on this machine, not a frame-rate guarantee.
The editor now retains its complete raster during gestures, removes the SVG mask
and coalesces wheel updates into animation frames. After navigation, high zoom
returns to full vector detail when bitmap resolution would be insufficient.
Geometry used for export and printing is unchanged.

## Desktop updates and HTML caching

Starting with v0.6.2, the loading screen reads the current icon from the bundled
frontend. Startup navigation includes a digest of the frontend entry page while
retaining the same origin, local storage and MCP address. HTML entry points use
`Cache-Control: no-store`; content-hashed assets retain conditional caching.

Flatpak/OSTree normalises installed file timestamps. The previous static handler
could return HTTP 304 for different HTML files with identical sizes and timestamps.
Regression coverage reproduces that collision and verifies fresh HTML after an
update, including `/`, `/index.html`, `/live` and `/upload`.

Fully quit the app before upgrading. Reinstallation does not replace a process
that is already running. Use the existing system/user installation location;
projects and preferences do not need to be deleted.
