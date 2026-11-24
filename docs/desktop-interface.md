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
