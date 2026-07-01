# GCodeScribe

A browser-based pen-plotter studio for turning PDF, SVG, image, Office and STL
files — plus generated templates, city maps, Markdown layouts, handwriting
fonts, and optional AI-assisted artwork — into safe G-code for an **Anycubic i3
Mega S**, any OctoPrint-backed printer, or a direct USB-serial Marlin setup.

<table>
  <tr>
    <td width="70%"><img src="media/images/design-and-plot.png" alt="GCodeScribe designer with artwork placed on the virtual plot bed" width="100%"></td>
    <td width="30%"><img src="media/images/pen-mount-printer.jpg" alt="Printer with pen mount prepared for plotting with GCodeScribe" width="100%"></td>
  </tr>
</table>

GCodeScribe combines document conversion, an interactive designer, an asset
gallery, AI image redrawing, OpenStreetMap city-road plotting, browser-side
generators, STL edge projection, handwriting font capture, live paper
calibration, G-code preview, and printer control in one small web app. Bring in
an existing file or generate something new, place it on the virtual bed, preview
the mapped toolpaths, and send it to the printer from the same interface.

## Highlights

<table>
  <tr>
    <td width="50%"><img src="media/images/ai-designer-preview.png" alt="AI Designer with generated line art and plotter-line preview"></td>
    <td width="50%"><img src="media/images/stl-editor.png" alt="STL editor projecting a 3D mesh into plotter-ready visible and hidden edge layers"></td>
  </tr>
  <tr>
    <td align="center"><strong>AI Designer</strong></td>
    <td align="center"><strong>STL Edge Projection</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="media/images/font-editor-preview.png" alt="Handwriting font editor showing captured glyphs and a writing-test preview"></td>
    <td width="50%"><img src="media/images/map-designer.png" alt="City road map generator with OpenStreetMap place search and plot preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Handwriting Fonts</strong></td>
    <td align="center"><strong>City Road Maps</strong></td>
  </tr>
</table>

## Features

### Convert, generate & remix

<table>
  <tr>
    <td width="50%"><img src="media/images/games-view.png" alt="Generator gallery with puzzles, games, maps and drawing templates"></td>
    <td width="50%"><img src="media/images/map-designer_editor.png" alt="Map editor previewing continuous road-line G-code and plottability metrics"></td>
  </tr>
</table>

- Convert PDF, SVG, raster images, and Office documents into plotter-ready
  G-code with [vpype](https://vpype.readthedocs.io).
- Trace image-only PDFs and scans with OpenCV while preserving vector paths
  from vector PDFs. Auto mode chooses the best conversion path automatically.
- Import STL meshes in the browser, orient them in 3D, choose visible/hidden
  edge rendering, add dimensions or a bounding box, and save the result as a
  re-editable gallery asset or insert it directly into the designer.
- Generate printable artwork directly in the browser — no source file needed:
  - **Puzzles:** mazes (classic, masked, hex, polar) and sudoku.
  - **Games:** dots &amp; boxes, tic-tac-toe, meta tic-tac-toe, connect four,
    battleships, bingo, and city/country/river sheets.
  - **Coloring pages:** mandalas and geometric pattern generators.
  - **Line art generators:** curve morphs and noodle-style path patterns.
  - **Maps:** search for a city or place, use its OSM boundary when available,
    and turn the road network into continuous, plotter-friendly vector linework.

<table>
  <tr>
    <td width="50%"><img src="media/images/ai-designer-empty.png" alt="AI Designer prompt and image upload screen before generation"></td>
    <td width="50%"><img src="media/images/galerie-view.png" alt="Gallery view with reusable uploaded and generated assets"></td>
  </tr>
</table>

- Use the optional **AI Designer** to turn a text prompt, photo, or sketch into
  plotter-ready black-on-white line art. Tune trace mode, detail, aspect
  ratio, effect, and lettering; create feedback-driven variants; and re-render
  plotter lines without another provider call.
- Keep every upload and generated design in the **gallery** — the one asset
  library for images, SVG, and multi-page PDF/Office documents (admin and public
  `/upload` submissions, filterable by origin) — with thumbnails, titles,
  archiving, plottability scores, and one-click reuse or insertion into the
  designer.

<table>
  <tr>
    <td width="70%"><img src="media/images/stl-editor.png" alt="STL editor with mesh preview, projection controls and line-layer preview"></td>
    <td width="30%"><img src="media/images/automaticchickenfeeder-plot.png" alt="Example mechanical STL-derived line drawing prepared for plotting"></td>
  </tr>
</table>

### Design, score & color

<table>
  <tr>
    <td width="50%"><img src="media/images/design-and-plot.png" alt="Design and Plot tab with artwork placed on the virtual plot bed"></td>
    <td width="50%"><img src="media/images/coloring.png" alt="Coloring editor for assigning linework to multiple pen colors"></td>
  </tr>
</table>

- Place documents visually in the **Design &amp; Plot** tab: upload to the
  gallery, insert any page onto the bed preview, then drag, rotate, scale,
  center, and fit artwork into the calibrated plot area — or quick-plot a page
  in two clicks.
- Draw from scratch on the paint canvas: place shapes and text, scale and
  arrange them, cover lower lines with mask rectangles, pan/zoom/rotate the
  canvas view, and turn the result into a plot job.
- Reduce pen lifts with continuous-stroke plotting: map networks, images and
  paint pages can be merged into one stroke per connected component, with
  retraces only on existing lines and a configurable merge tolerance.
- Lay out plot-friendly notes, cards, and worksheets with the built-in
  Markdown editor, then insert them as vector text into the designer.
- See plottability feedback before printing: gallery items, AI outputs, and
  paint pages are scored so overly slow, tiny, or fragmented drawings stand
  out early.
- Use the **Coloring Editor** to assign linework to multiple pen colors and
  generate separate G-code jobs per color for pen-swap workflows.

### Fonts & handwriting

<table>
  <tr>
    <td width="50%"><img src="media/images/font-editor.png" alt="Font editor with glyph drawing canvas, guide lines and captured characters"></td>
    <td width="50%"><img src="media/images/font-settings.png" alt="Settings dialog for managing built-in, custom and handwriting fonts"></td>
  </tr>
</table>

- Capture your own handwriting in the **Font Editor**: draw glyphs with mouse,
  touch or pen, use guide lines for baseline/x-height/cap-height, and preview
  words in the writing-test player before using the font in artwork.
- Stabilize strokes while drawing or reprocess glyphs afterwards with smoothing,
  inertia, simplification and endpoint snapping controls.
- Manage fonts in settings: keep built-in plotter fonts, upload `.otf`/`.ttf`
  files, import/export `.gcsfont` handwriting backups, and choose whether custom
  fonts render as normal outlines or plotter-optimized centerlines.
- Stroke fonts preserve per-point feed information, so handwritten text can be
  plotted with more natural speed variation instead of a flat feedrate.

### Calibrate &amp; plot safely

<table>
  <tr>
    <td width="50%"><img src="media/images/calibration.png" alt="Calibration profile editor with plot area, feedrate and optimization settings"></td>
    <td width="50%"><img src="media/images/live-calibration.png" alt="Live paper calibration wizard showing captured paper corners"></td>
  </tr>
</table>

- Calibrate pen-up and pen-down Z heights, plot area, origin offsets, margins,
  feedrates, and merge tolerance from the browser.
- Use the live paper calibration wizard to home the machine, jog to sheet
  corners, capture paper bounds, and map every conversion onto the real sheet.
- Manage multiple calibration profiles (e.g. "A4 portrait", "postcard front
  left", "thick paper"): create, duplicate, activate, archive, and im-/export
  them as JSON — single profiles or a full bundle. Existing installations are
  migrated into a default profile automatically.
- Every generated job and paint page is bound to the profile it was created
  with (id + fingerprint over all safety-relevant values). The backend refuses
  to send a job whose profile does not exactly match the active one — foreign,
  changed (stale), archived, deleted, or pre-profile legacy jobs stay visible
  but are not printable until regenerated or explicitly adopted.
- Enforce safety checks before saving or printing: generated jobs never contain
  `G28`, Z moves are limited to calibrated pen heights, and drawing moves must
  stay inside the configured plot area.
- Export calibration as XML and embed calibration metadata in every generated
  G-code job.

### Preview &amp; control

<table>
  <tr>
    <td width="50%"><img src="media/images/gcode-preview.png" alt="G-code preview mapped onto the printer bed and calibrated paper"></td>
    <td width="50%"><img src="media/images/control.png" alt="Printer control tab with backend status, jogging and job controls"></td>
  </tr>
</table>

- Preview generated G-code against the bed and calibrated paper before sending
  it to the printer.
- Start a second-screen live view from the designer, games, gallery, or AI
  results: canvas edits, game templates, gallery previews, and 3D G-code
  previews can stay live while you switch tabs.
- Run through OctoPrint or direct USB serial from the same UI. If both are
  configured, switch the active backend at runtime without restarting.
- Track the head position from sent commands and persist it in Redis, with a
  file-store fallback for simple local setups.
- Enable optional browser notifications for plot progress milestones while a
  job is running.
- Send, start, pause, cancel, home, jog, and lift/lower the pen through
  OctoPrint or the serial backend from the same UI.

## Run with Docker (recommended)

```bash
cp .env.example .env
# edit .env: set OCTOPRINT_* or enable PRINTER_SERIAL_*; optionally set OPENAI_API_KEY
docker compose up --build
```

Open <http://localhost:8000>. Calibration and generated jobs are persisted in
the `gcodescribe-data` volume (`/data`).

Set `OPENAI_API_KEY` to enable the AI Designer tab, or `AI_IMAGE_FAKE=true`
for cost-free local testing.

For direct USB/serial plotting from Docker, pass the device through to the
container and enable the serial backend:

```bash
docker run --rm -p 8000:8000 \
  --device=/dev/ttyUSB0 \
  -v gcodescribe-data:/data \
  -e PRINTER_SERIAL_ENABLED=true \
  -e PRINTER_SERIAL_PORT=/dev/ttyUSB0 \
  ghcr.io/noweck/gcodescribe:latest
```

With Compose, add the serial device to the app service and set the same
`PRINTER_SERIAL_*` values in `.env`.

On first opening the admin app, create the local admin account and enroll a
TOTP authenticator. The public `/upload` page stays available without login;
the normal app and API are protected by the admin session. Plain HTTP works for
local/LAN use, but passwords, TOTP codes and session cookies can be observed on
the network; use HTTPS if the controller is exposed beyond a trusted setup.

> PDF support works out of the box (`poppler-utils` provides `pdftocairo`,
> `pdftoppm` and `pdfinfo`; OpenCV does the tracing). For Office documents,
> add `libreoffice-core` to the runtime stage in the `Dockerfile`.

> OSM map generation uses Nominatim for place search and the public Overpass API
> from the backend. Boundary mode can request a whole city area; for very large
> places, reduce detail or pick a smaller search result to keep generation fast.

### MCP access for AI clients

The Docker/web app can expose an optional Model Context Protocol endpoint at
`/mcp`. Enable it in **Settings → MCP**, generate an access token, and configure
the AI client to call the shown URL with `Authorization: Bearer <token>`.

MCP is disabled by default and is not enabled for the Flatpak/Desktop build yet.
Treat the token like a machine-control credential: MCP tools can home the plotter,
move the head within configured limits, pause/cancel jobs, create designer pages,
generate jobs and start plotting. Use HTTPS or a trusted local network.

The MCP surface deliberately does **not** expose raw G-code or raw serial writes.
AI clients draw by creating/placing page content (polylines, text or gallery
items). Every plot path still goes through the active profile, page/profile
fingerprints, G-code generation and safety checks. If inserted content would
leave the active plot area, the tool returns an error containing the active
profile dimensions and nothing is saved or plotted.

Available MCP tool groups include:

- Read status: printer status/position, active profile, pages, fonts, gallery,
  jobs, SVG previews.
- Draw and plot: create a new page from polylines/text/gallery items and plot it,
  or add those elements to an existing page and plot the updated page.
- Safe printer control: home, move to a bounded coordinate, pen up/down, and
  pause/resume/cancel the active job.

#### Connect Claude, Codex or OpenCode

1. Start GCodeScribe and open **Settings → MCP**.
2. Enable MCP, generate a token and copy the endpoint URL, usually
   `http://localhost:8000/mcp`.
3. Store the token outside version control, for example:

```bash
export GCODESCRIBE_MCP_TOKEN='paste-token-from-settings'
```

**Claude Code** supports remote HTTP MCP servers with custom headers:

```bash
claude mcp add --transport http gcodescribe http://localhost:8000/mcp \
  --header "Authorization: Bearer $GCODESCRIBE_MCP_TOKEN"
```

For a project-local `.mcp.json` without committing secrets, use environment
expansion:

```json
{
  "mcpServers": {
    "gcodescribe": {
      "type": "http",
      "url": "${GCODESCRIBE_MCP_URL:-http://localhost:8000/mcp}",
      "headers": {
        "Authorization": "Bearer ${GCODESCRIBE_MCP_TOKEN}"
      }
    }
  }
}
```

Run `claude mcp list` or open `/mcp` inside Claude Code to verify the server.

**Codex CLI / IDE extension** share `config.toml`. Add this to
`~/.codex/config.toml` or `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.gcodescribe]
url = "http://localhost:8000/mcp"
# This is the environment variable name, not the token value itself.
bearer_token_env_var = "GCODESCRIBE_MCP_TOKEN"
startup_timeout_sec = 20
tool_timeout_sec = 120
enabled = true
```

Before starting Codex, export the token in the same shell/session that launches
Codex:

```bash
export GCODESCRIBE_MCP_TOKEN='paste-token-from-settings'
codex
```

If you accidentally set `bearer_token_env_var` to the token itself, Codex will
try to read an environment variable with that long token as its name and fail
with an error like `Environment variable <token> for MCP server 'gcodescribe' is
not set`.

Then start Codex and use `/mcp` in the TUI to check the connection. If your
GCodeScribe instance is not local, replace the URL with the HTTPS endpoint.

**OpenCode** uses the `mcp` section in `opencode.json`/`opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "gcodescribe": {
      "type": "remote",
      "url": "http://localhost:8000/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:GCODESCRIBE_MCP_TOKEN}"
      },
      "timeout": 120000
    }
  }
}
```

Use `opencode mcp list` to inspect configured servers. For non-local access,
serve GCodeScribe behind HTTPS and use that HTTPS `/mcp` URL.

Because this MCP can move real hardware, keep it out of shared repository config
unless the config contains only environment-variable references. Prefer local or
user-scoped client config and rotate the MCP token from Settings if it is exposed.

### Production

`compose.prod.yml` switches `compose.yml` to the pre-built image released to
GHCR rather than building locally, with `PLOTTER_AUTH_COOKIE_SECURE` defaulting
to `true` (terminate TLS at a reverse proxy in front of the service):

```bash
cp .env.example .env   # set OCTOPRINT_* or PRINTER_SERIAL_*
docker compose -f compose.yml -f compose.prod.yml pull
docker compose -f compose.yml -f compose.prod.yml up -d
```

Pin a version with `GCODESCRIBE_TAG` (defaults to `latest`); images are tagged
`vX.Y.Z`, `X.Y` and `latest` by the release workflow. Both services run an
unprivileged user, declare health checks, cap their logs (10 MB × 3) and set
memory limits.

## Local development

`make dev` opens an interactive dev cockpit. From there you can toggle Redis,
backend, frontend, Serial settings and optional preflight checks (pytest, ruff,
frontend build) before starting the stack. The local dev backend defaults to
<http://localhost:8010> so it does not collide with a Docker/production service
already using port 8000.

For automation or a direct start without the menu, use `make dev-plain`.

Backend only (FastAPI via uvicorn):

```bash
uv sync
OCTOPRINT_URL=... OCTOPRINT_API_KEY=... uv run gcodescribe-web
```

Frontend (Vite dev server, proxies `/api` to the backend on `PLOTTER_PORT`,
default `8010` for local dev):

```bash
cd frontend
npm install
npm run dev
```

`npm run build` writes the production SPA into `plotter/web/static`, which the
backend serves automatically.

## Configuration

| Variable            | Purpose                             | Default   |
| ------------------- | ----------------------------------- | --------- |
| `OCTOPRINT_URL`     | Base URL of your OctoPrint instance | —         |
| `OCTOPRINT_API_KEY` | OctoPrint API key                   | —         |
| `OCTOPRINT_VERIFY_SSL` | Verify OctoPrint TLS certificates | `true`    |
| `PRINTER_SERIAL_ENABLED` | Enable the direct USB-serial backend | `false` |
| `PRINTER_DEFAULT_BACKEND` | Initial backend (`octoprint`\|`serial`) until a choice is persisted | first available |
| `PRINTER_SERIAL_PORT` | Serial device when serial is enabled | `/dev/ttyUSB0` |
| `PRINTER_SERIAL_BAUD` | Serial baud rate                    | `115200`  |
| `PRINTER_USE_SERIAL` | Deprecated alias for `PRINTER_SERIAL_ENABLED=true` + default serial | `false` |
| `PLOTTER_HOST_PORT` | Host port used by Docker Compose    | `8000`    |
| `PLOTTER_DATA_DIR`  | Where calibration + jobs are stored | `data`    |
| `PLOTTER_HOST`      | Bind host                           | `0.0.0.0` |
| `PLOTTER_PORT`      | Bind port                           | `8000`    |
| `REDIS_URL`         | Position cache (falls back to a file store under `<data>/state/` if unreachable) | `redis://localhost:6379/0` |
| `PLOTTER_AUTH_SESSION_TTL` | Admin session lifetime in seconds | `1209600` |
| `PLOTTER_AUTH_COOKIE_SECURE` | Mark session cookie HTTPS-only | `false` |
| `GCODESCRIBE_TAG`   | GHCR image tag (prod compose only)  | `latest`  |
| `OPENAI_API_KEY`    | Enable AI Designer with the real OpenAI image backend | — |
| `AI_IMAGE_FAKE`     | Enable the fake AI Designer backend for local testing | `false` |
| `OPENAI_IMAGE_MODEL` | OpenAI image model used by AI Designer | `gpt-image-2` |
| `OPENAI_IMAGE_API_MODE` | OpenAI image API mode | `image-api` |
| `AI_IMAGE_SIZE`     | Requested AI output size             | `1024x1024` |
| `AI_IMAGE_QUALITY`  | Requested AI output quality          | `auto`    |
| `AI_IMAGE_MAX_INPUT_MB` | Max upload size for AI input images | `10`   |
| `AI_IMAGE_TIMEOUT_SECONDS` | Timeout for AI image generation requests | `90` |

### Direct USB serial (without OctoPrint)

Set `PRINTER_SERIAL_ENABLED=true` to talk to the printer's Marlin firmware
directly over USB, with no OctoPrint in between. A background worker streams the
G-code line by line (waiting for each `ok`), so status, progress, pause and
cancel work just like the OctoPrint backend — the UI is unchanged. Configure the
device with `PRINTER_SERIAL_PORT` and `PRINTER_SERIAL_BAUD`.

**Both at once.** If OctoPrint (`OCTOPRINT_URL` + `OCTOPRINT_API_KEY`) *and*
serial are configured, a switch appears in the control panel to pick the active
backend at runtime — no restart needed. The choice is persisted under
`<data>/printer_backend.json`; `PRINTER_DEFAULT_BACKEND` sets the initial one.
Only the active backend talks to a printer. If serial is active at process start,
the backend opens the USB port immediately and keeps it for the backend/container
lifetime. If you switch away from serial, the port is released; switching back
opens it again. Point serial and OctoPrint at different physical access paths.
Switching forces a re-home (the real position is unknown after the change) and is
blocked while a job is printing.

Notes:

- Prefer a stable path like `/dev/serial/by-id/...` over `/dev/ttyUSB0`, which can
  change across reboots (`ls -l /dev/serial/by-id/`).
- Many Anycubic i3 Mega S firmwares use `PRINTER_SERIAL_BAUD=250000`; `115200` is
  still common for other Marlin boards.
- Run only **one** web worker in serial mode — multiple processes would fight
  over the port.
- In Docker, `compose.yml` passes `PRINTER_SERIAL_PORT` through as a device and
  adds the container process to `PRINTER_SERIAL_GROUP` (`dialout` by default). If
  you set `PRINTER_SERIAL_PORT=/dev/serial/by-id/...`, that same path is passed
  through. Find the right group id with `stat -c '%g' /dev/ttyUSB0` if `dialout`
  doesn't match.

Calibration values (bed/plot size, origin, pen Z, feedrates) are edited in the
UI and stored as profiles under `<data>/profiles/` — one JSON file per profile
plus `active.json` for the selected one. `<data>/calibration.json` is kept as a
mirror of the active profile for backwards compatibility; on first start an
existing `calibration.json` is migrated into a default profile (with a one-time
`calibration.json.pre-profiles.bak` backup). The active calibration is applied
on every conversion: the vpype G-code profile is generated on the fly, the
drawing is laid out into the plot area, Y is flipped into printer space and
shifted by the origin offset.

Every generated job gets a JSON sidecar next to its `.gcode` file recording the
source and the profile (id, name, fingerprint) it was created with. Sending a
job to OctoPrint requires the sidecar profile to match the active profile
exactly; blocked attempts are logged with the reason.

## CLI

The original command-line converter is still available:

```bash
uv run gcodescribe input.pdf --output out/
uv run gcodescribe input.svg --profile anycubic
```

## How the G-code is built

- PDF / Office input is rendered to SVG (`pdftocairo`, `soffice`); generators
  and the paint canvas produce SVG directly.
- vpype reads the SVG, simplifies / merges / sorts lines, lays it out into the
  plot area and writes G-code with a generated `gwrite` profile.
- Pen up/down are absolute Z moves at the calibrated heights; travel and draw
  moves use the calibrated feedrates.
