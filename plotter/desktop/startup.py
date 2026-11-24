"""Desktop startup assets and navigation, independent of GTK."""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parents[1] / "web" / "static"

_STARTING = {
    "en": "Starting GCodeScribe…",
    "de": "GCodeScribe wird gestartet…",
    "ba": "GCodeScribe startet…",
    "fr": "Démarrage de GCodeScribe…",
    "es": "Iniciando GCodeScribe…",
}


def desktop_start_url(origin: str, static_dir: Path = STATIC_DIR) -> str:
    """Bypass HTML cached by earlier Flatpak versions, keeping the MCP origin stable."""
    try:
        revision = hashlib.sha256((static_dir / "index.html").read_bytes()).hexdigest()[:16]
    except OSError:
        # Development without a frontend still gets the normal backend error page.
        revision = "unbuilt"
    return f"{origin.rstrip('/')}/?desktop_build={revision}"


def loading_html(language: str = "en", static_dir: Path = STATIC_DIR) -> str:
    language = language.split(".")[0].replace("_", "-").split("-")[0].lower()
    if language == "bar":
        language = "ba"
    language = language if language in _STARTING else "en"
    label = _STARTING[language]
    try:
        icon = base64.b64encode((static_dir / "icon.svg").read_bytes()).decode("ascii")
        mark = (
            f'<img src="data:image/svg+xml;base64,{icon}" '
            'alt="GCodeScribe" width="96" height="96">'
        )
    except OSError:
        mark = '<span class="monogram" aria-hidden="true">G</span>'
    return _TEMPLATE.replace("__LANG__", "bar" if language == "ba" else language).replace(
        "__ICON__", mark
    ).replace("__STARTING__", label)


_TEMPLATE = """<!doctype html>
<html lang="__LANG__">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GCodeScribe</title>
<style>
  :root { color-scheme: light dark; --bg: #f1f4f8; --ink: #1e293b; --muted: #64748b;
          --track: #dbe3ed; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #202731; --ink: #f1f5f9; --muted: #b1bdcd; --track: #374151;
            --accent: #60a5fa; }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; }
  body { display: grid; place-items: center; background: var(--bg); color: var(--ink);
         font: 14px/1.5 system-ui, sans-serif; user-select: none; }
  main { display: flex; flex-direction: column; align-items: center; gap: 16px;
         padding: 24px; max-width: 100%; text-align: center; }
  img { display: block; border-radius: 20px; }
  .monogram { font-size: 72px; font-style: italic; }
  h1 { margin: 0; font-size: 25px; font-weight: 650; letter-spacing: -.025em; }
  p { margin: 0; color: var(--muted); }
  .progress { width: 160px; height: 3px; border-radius: 3px; overflow: hidden;
              background: var(--track); }
  .progress::after { content: ''; display: block; width: 45%; height: 100%;
                     background: var(--accent); animation: progress 1.4s ease-in-out infinite; }
  @keyframes progress { from { transform: translateX(-100%); }
                        to { transform: translateX(325%); } }
  @media (prefers-reduced-motion: reduce) {
    .progress::after { animation: none; width: 100%; opacity: .65; }
  }
</style>
<main>
  __ICON__
  <h1>GCodeScribe</h1>
  <p role="status">__STARTING__</p>
  <div class="progress" aria-hidden="true"></div>
</main>
</html>
"""
