"""Open external WebKit links through GTK's browser/desktop portal."""
from __future__ import annotations

import logging
from urllib.parse import urlsplit

log = logging.getLogger(__name__)


class DesktopLinks:
    def __init__(self, view, parent, origin: str, *, toolkit=None):
        if toolkit is None:
            from gi.repository import Gtk, WebKit

            toolkit = (Gtk, WebKit)
        self.gtk, self.webkit = toolkit
        self.parent = parent
        self.origin = self._origin(origin)
        view.connect("decide-policy", self._decide)

    @staticmethod
    def _origin(uri: str) -> tuple:
        parsed = urlsplit(uri)
        return parsed.scheme, parsed.hostname, parsed.port

    def _decide(self, _view, decision, kind) -> bool:
        policies = self.webkit.PolicyDecisionType
        if kind not in (policies.NAVIGATION_ACTION, policies.NEW_WINDOW_ACTION):
            return False
        uri = decision.get_navigation_action().get_request().get_uri()
        try:
            origin = self._origin(uri)
        except ValueError:
            return False
        if origin[0] not in ("http", "https") or origin == self.origin:
            return False
        # Keep the local application in its WebView; authentication belongs in
        # the user's browser. This also handles explicit target="_blank" links.
        decision.ignore()
        try:
            self.gtk.UriLauncher.new(uri).launch(self.parent, None, self._opened)
        except Exception:
            log.warning("External link could not be opened", exc_info=True)
        return True

    @staticmethod
    def _opened(launcher, result) -> None:
        try:
            launcher.launch_finish(result)
        except Exception:
            log.warning("External link could not be opened", exc_info=True)
