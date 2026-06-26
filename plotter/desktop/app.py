"""GTK4 + WebKit desktop wrapper for GCodeScribe.

Lifecycle:
  1. do_startup  – find free port, create data dirs, launch backend subprocess
  2. do_activate – open main window with a loading screen
  3. background thread waits for /api/health, then navigates WebView to app URL
  4. user closes window → GTK application quits → do_shutdown terminates backend
"""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import gi

gi.require_version("Gdk", "4.0")
gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")

from gi.repository import Gdk, Gio, GLib, Gtk, WebKit  # noqa: E402

log = logging.getLogger(__name__)

APP_ID = "info.noweck.gcodescribe"
BACKEND_TIMEOUT = 30.0  # seconds to wait for /api/health


# ── helpers ───────────────────────────────────────────────────────────────────


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _poll_health(url: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"{url}/api/health", timeout=1)
            return True
        except Exception:
            time.sleep(0.25)
    return False


_LOADING_HTML = """\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  :root {
    --bg: #0d0d0f;
    --accent: #0a84ff;
    --text: #f5f5f7;
    --muted: #98989e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: radial-gradient(900px 500px at 50% -80px, #111a2e 0%, var(--bg) 65%);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
                 Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .splash {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    user-select: none;
  }
  .icon-wrap {
    width: 92px;
    height: 92px;
    border-radius: 22px;
    background: rgba(10, 132, 255, 0.08);
    border: 1px solid rgba(10, 132, 255, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 0 rgba(10, 132, 255, 0.25), 0 12px 40px rgba(0, 0, 0, 0.45);
    animation: glow 2.6s ease-in-out infinite alternate;
  }
  @keyframes glow {
    from { box-shadow: 0 0 28px rgba(10, 132, 255, 0.10), 0 12px 40px rgba(0,0,0,0.45); }
    to   { box-shadow: 0 0 56px rgba(10, 132, 255, 0.32), 0 12px 40px rgba(0,0,0,0.45); }
  }
  .icon-wrap svg { width: 56px; height: 56px; }
  h1 {
    font-size: 26px;
    font-weight: 650;
    letter-spacing: -0.03em;
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .dots {
    display: flex;
    gap: 7px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.3s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.22s; }
  .dot:nth-child(3) { animation-delay: 0.44s; }
  @keyframes pulse {
    0%, 80%, 100% { opacity: 0.25; transform: scale(0.75); }
    40%           { opacity: 1;    transform: scale(1.2);  }
  }
  .label {
    font-size: 13px;
    color: var(--muted);
    letter-spacing: 0.01em;
  }
</style>
</head>
<body>
  <div class="splash">
    <div class="icon-wrap">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="12" fill="#1d4ed8"/>
        <polygon points="32,6 44,38 32,32 20,38" fill="#ffffff" opacity="0.95"/>
        <polygon points="32,32 44,38 32,44" fill="#93c5fd"/>
        <path d="M10,54 Q20,44 32,50 Q44,56 54,46"
              fill="none" stroke="#ffffff" stroke-width="3"
              stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
      </svg>
    </div>
    <h1>GCodeScribe</h1>
    <div class="status">
      <div class="dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      <span class="label">Wird gestartet …</span>
    </div>
  </div>
</body>
</html>
"""


# ── window ────────────────────────────────────────────────────────────────────


class MainWindow(Gtk.ApplicationWindow):
    def __init__(self, application: App) -> None:
        super().__init__(application=application, title="GCodeScribe")
        self.set_default_size(1400, 900)

        # WebView — kiosk-mode: no browser chrome, no escape hatches
        self._wv = WebKit.WebView()
        wv_settings = self._wv.get_settings()
        wv_settings.set_enable_developer_extras(False)
        wv_settings.set_javascript_can_open_windows_automatically(False)
        self.set_child(self._wv)

        # Suppress right-click context menu entirely (no "Untersuchen" / Inspect)
        self._wv.connect("context-menu", lambda *_: True)

        # Intercept keys in capture phase — before WebKit processes them —
        # to block all browser-style DevTools shortcuts.
        key_capture = Gtk.EventControllerKey()
        key_capture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        key_capture.connect("key-pressed", self._block_devtools_keys)
        self._wv.add_controller(key_capture)

        self._wv.load_html(_LOADING_HTML, "about:blank")

        # Ctrl+Q
        shortcut_ctrl = Gtk.ShortcutController(scope=Gtk.ShortcutScope.GLOBAL)
        shortcut_ctrl.add_shortcut(
            Gtk.Shortcut(
                trigger=Gtk.ShortcutTrigger.parse_string("<Control>q"),
                action=Gtk.CallbackAction.new(self._on_quit_shortcut),
            )
        )
        self.add_controller(shortcut_ctrl)

    def _on_quit_shortcut(self, *_: object) -> bool:
        self.get_application().quit()
        return True

    def _block_devtools_keys(
        self,
        _ctrl: Gtk.EventControllerKey,
        keyval: int,
        _keycode: int,
        state: Gdk.ModifierType,
    ) -> bool:
        CTRL = Gdk.ModifierType.CONTROL_MASK
        SHIFT = Gdk.ModifierType.SHIFT_MASK
        mod = state & (CTRL | SHIFT)

        # F12 — DevTools toggle
        if keyval == Gdk.KEY_F12:
            return True
        # Ctrl+Shift+I — Inspect Element
        # Ctrl+Shift+C — Inspect Element (Chrome variant)
        # Ctrl+Shift+J — JavaScript Console
        if mod == (CTRL | SHIFT) and keyval in (
            Gdk.KEY_i, Gdk.KEY_I,
            Gdk.KEY_c, Gdk.KEY_C,
            Gdk.KEY_j, Gdk.KEY_J,
        ):
            return True
        # Ctrl+U — View Page Source
        if mod == CTRL and keyval in (Gdk.KEY_u, Gdk.KEY_U):
            return True
        return False

    def navigate(self, url: str) -> None:
        self._wv.load_uri(url)


# ── application ───────────────────────────────────────────────────────────────


class App(Gtk.Application):
    def __init__(self) -> None:
        super().__init__(
            application_id=APP_ID,
            flags=Gio.ApplicationFlags.FLAGS_NONE,
        )
        self._port: int = _free_port()
        self._url: str = f"http://127.0.0.1:{self._port}"
        self._backend: subprocess.Popen | None = None  # type: ignore[type-arg]
        self._window: MainWindow | None = None

    # ── startup / activate ────────────────────────────────────────────────────

    def do_startup(self) -> None:
        Gtk.Application.do_startup(self)
        self._launch_backend()

    def do_activate(self) -> None:
        if self._window is not None:
            self._window.present()
            return
        self._window = MainWindow(application=self)
        self._window.present()
        threading.Thread(target=self._health_thread, daemon=True).start()

    # ── backend management ────────────────────────────────────────────────────

    def _data_dir(self) -> str:
        """Persistent data directory.

        In Flatpak the sandbox maps GLib.get_user_data_dir() to
        ~/.var/app/<app-id>/data, which is already persistent.
        Override with PLOTTER_DATA_DIR for non-Flatpak or testing.
        """
        return os.environ.get(
            "PLOTTER_DATA_DIR",
            os.path.join(GLib.get_user_data_dir(), "gcodescribe"),
        )

    def _launch_backend(self) -> None:
        data_dir = self._data_dir()
        for sub in ("profiles", "state", "jobs", "gallery", "settings", "auth", "sources"):
            os.makedirs(os.path.join(data_dir, sub), exist_ok=True)

        env = os.environ.copy()
        env.update(
            {
                "PLOTTER_HOST": "127.0.0.1",
                "PLOTTER_PORT": str(self._port),
                "PLOTTER_DATA_DIR": data_dir,
                "STATE_STORE": "file",
                "REDIS_URL": "",
                "GCODESCRIBE_PACKAGING": "flatpak",
            }
        )

        try:
            self._backend = subprocess.Popen(
                ["gcodescribe-web"],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            log.info("Backend gestartet (PID %d, port %d)", self._backend.pid, self._port)
        except FileNotFoundError:
            GLib.idle_add(self._fatal, "gcodescribe-web wurde nicht gefunden.")

    def _health_thread(self) -> None:
        if _poll_health(self._url, BACKEND_TIMEOUT):
            GLib.idle_add(self._on_ready)
        else:
            crashed = self._backend is not None and self._backend.poll() is not None
            msg = (
                f"Backend abgestürzt (Exitcode {self._backend.returncode})."
                if crashed
                else f"Backend nicht erreichbar nach {BACKEND_TIMEOUT:.0f} s."
            )
            GLib.idle_add(self._fatal, msg)

    def _on_ready(self) -> bool:
        if self._window is not None:
            self._window.navigate(self._url)
        return False

    def _fatal(self, detail: str) -> bool:
        log.error("Fatal: %s", detail)
        dialog = Gtk.AlertDialog()
        dialog.set_message("GCodeScribe konnte nicht starten")
        dialog.set_detail(detail)
        dialog.set_buttons(["Beenden"])
        dialog.choose(self._window, None, lambda *_: self.quit())
        return False

    # ── shutdown ──────────────────────────────────────────────────────────────

    def do_shutdown(self) -> None:
        self._stop_backend()
        Gtk.Application.do_shutdown(self)

    def _stop_backend(self) -> None:
        if self._backend is None or self._backend.poll() is not None:
            return
        log.info("Beende Backend (PID %d) …", self._backend.pid)
        self._backend.terminate()
        try:
            self._backend.wait(timeout=3)
        except subprocess.TimeoutExpired:
            log.warning("Backend reagiert nicht, sende SIGKILL.")
            self._backend.kill()
            self._backend.wait()
        self._backend = None


# ── entry point ───────────────────────────────────────────────────────────────


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s  %(name)s  %(message)s",
    )
    sys.exit(App().run(sys.argv))
