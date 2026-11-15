# GCodeScribe

Convert documents into pen-plotter G-code and control a plotter through the web UI.

## Docker Compose

Copy the example environment file if you want to configure OctoPrint, serial output, ports, or optional AI image generation:

```sh
cp .env.example .env
```

Build and start the app:

```sh
docker compose up --build
```

The web UI is available at `http://localhost:8000` by default. Set `PLOTTER_HOST_PORT` in `.env` to expose another host port.

To use the pre-built GHCR image instead of building locally:

```sh
docker compose -f compose.yml -f compose.prod.yml up -d
```

## Local Development

Install dependencies:

```sh
make setup
```

Start the interactive development launcher:

```sh
make dev
```

For automation or a direct non-interactive start, use:

```sh
make dev-plain
```

The frontend checks for file changes every 500 ms, so development also works
when Linux's inotify watcher limit is exhausted. Hot reload remains available.
To use native file watching instead, run `CHOKIDAR_USEPOLLING=false make dev`.

## Install a release

Download the `.deb` from the [release page](https://github.com/Friedjof/gcodescribe/releases/latest), then install and start the web application:

```sh
sudo apt install ./gcodescribe_0.5.1_amd64.deb
gcodescribe-web
```

Open `http://localhost:8000`. The package requires Python 3.12 and provides the CLI and web server. Use the Flatpak release asset for the GTK desktop application. RPM and AppImage packages are also attached to releases.

## Features

- Organize drawings into projects, nested folders and slides with project-specific calibration.
- Import SVG, images, PDF, Office documents and native Xournal++ pen strokes; process imports in the background.
- Design text and drawings, preview tool paths in 3D and generate pen-plotter G-code.
- Create OSM map drawings with cached downloads and selectable stroke routing.
- Control printers through OctoPrint or a serial connection, including pause/resume and configurable park and pen insertion positions.

See the [0.5.1 release notes](docs/releases/0.5.1.md) for features, fixes and upgrade details.

## Build installation packages

```sh
make deb
```

This builds in Docker and writes the `.deb` to the repository root. `make rpm`, `make appimage` and `make packages` build the other distribution formats.
