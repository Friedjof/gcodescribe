"""Keep the native GTK color scheme and the local WebKit UI in sync."""

from __future__ import annotations

import json
from urllib.parse import urlsplit


class DesktopAppearance:
    def __init__(self, view, origin: str, *, toolkit=None):
        if toolkit is None:
            import gi

            gi.require_version("Adw", "1")
            from gi.repository import Adw, WebKit

            toolkit = (Adw, WebKit)
        self.adw, self.webkit = toolkit
        self.adw.init()
        self.view, self.origin = view, origin
        self.style = self.adw.StyleManager.get_default()
        manager = view.get_user_content_manager()
        manager.register_script_message_handler("gcsAppearance", None)
        manager.connect("script-message-received::gcsAppearance", self._requested)
        script = self._script()
        manager.add_script(
            self.webkit.UserScript.new(
                script,
                self.webkit.UserContentInjectedFrames.TOP_FRAME,
                self.webkit.UserScriptInjectionTime.START,
                None,
                None,
            )
        )
        self.style.connect("notify::dark", self._publish)
        view.connect("load-changed", self._loaded)

    def _trusted(self) -> bool:
        actual, expected = urlsplit(self.view.get_uri() or ""), urlsplit(self.origin)
        return (actual.scheme, actual.netloc) == (expected.scheme, expected.netloc)

    def _script(self) -> str:
        dark = json.dumps(bool(self.style.get_dark()))
        origin = json.dumps(self.origin)
        return (
            f"if(location.origin==={origin}){{"
            f"window.__GCODESCRIBE_DESKTOP__=Object.freeze({{dark:{dark}}});"
            "if(document.documentElement)document.documentElement.dataset.desktop='true';"
            "dispatchEvent(new Event('gcs:desktop-appearance'));}"
        )

    def _requested(self, _manager, value) -> None:
        if not self._trusted():
            return
        if hasattr(value, "get_js_value"):
            value = value.get_js_value()
        modes = {
            "system": self.adw.ColorScheme.DEFAULT,
            "light": self.adw.ColorScheme.FORCE_LIGHT,
            "dark": self.adw.ColorScheme.FORCE_DARK,
        }
        mode = modes.get(value.to_string())
        if mode is not None:
            self.style.set_color_scheme(mode)

    def _publish(self, *_args) -> None:
        if self._trusted():
            self.view.evaluate_javascript(self._script(), -1, None, None, None, None, None)

    def _loaded(self, _view, event) -> None:
        if event == self.webkit.LoadEvent.FINISHED:
            self._publish()
