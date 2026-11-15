"""Map WebKit's notification permission and delivery to the desktop application."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from urllib.parse import urlsplit

from plotter.core.jsonstore import atomic_write_json

log = logging.getLogger(__name__)


class DesktopNotifications:
    def __init__(self, application, context, origin: str, preferences: Path, *, toolkit=None):
        if toolkit is None:
            from gi.repository import Gio, Gtk, WebKit

            toolkit = (Gio, Gtk, WebKit)
        self.gio, self.gtk, self.webkit = toolkit
        self.application = application
        self.origin = origin
        self.preferences = preferences
        self.allowed = self._load_permission()
        self._notifications: dict[str, object] = {}
        context.connect("initialize-notification-permissions", self._initialize_permissions)

    def _load_permission(self) -> bool:
        try:
            return json.loads(self.preferences.read_text()).get("allowed") is True
        except (OSError, ValueError, AttributeError):
            return False

    def attach(self, view, parent) -> None:
        self.parent = parent
        view.connect("permission-request", self._request_permission)
        view.connect("show-notification", self._show_notification)

    def _trusted(self, view) -> bool:
        actual, expected = urlsplit(view.get_uri() or ""), urlsplit(self.origin)
        return (actual.scheme, actual.netloc) == (expected.scheme, expected.netloc)

    def _initialize_permissions(self, context) -> None:
        allowed = [self.webkit.SecurityOrigin.new_for_uri(self.origin)] if self.allowed else []
        context.initialize_notification_permissions(allowed, [])

    def _request_permission(self, view, request) -> bool:
        if not isinstance(request, self.webkit.NotificationPermissionRequest):
            return False
        if not self._trusted(view):
            request.deny()
            return True
        if self.allowed:
            request.allow()
            return True
        dialog = self.gtk.AlertDialog()
        dialog.set_message("Benachrichtigungen erlauben?")
        dialog.set_detail(
            "GCodeScribe meldet Plot-Fortschritt und Abschluss auch bei minimiertem Fenster."
        )
        dialog.set_buttons(["Nicht erlauben", "Erlauben"])
        dialog.set_cancel_button(0)
        dialog.set_default_button(1)

        def chosen(source, result):
            try:
                allow = source.choose_finish(result) == 1
            except Exception:
                allow = False
            if allow:
                self.allowed = True
                try:
                    atomic_write_json(self.preferences, {"allowed": True})
                except OSError:
                    log.warning("Notification permission could not be saved")
                request.allow()
            else:
                request.deny()

        dialog.choose(self.parent, None, chosen)
        return True

    def _show_notification(self, view, notification) -> bool:
        if not self.allowed or not self._trusted(view):
            return True
        identifier = notification.get_tag() or f"web-{notification.get_id()}"
        native = self.gio.Notification.new(notification.get_title())
        native.set_body(notification.get_body())
        native.set_icon(self.gio.ThemedIcon.new(self.application.get_application_id()))
        native.set_default_action("app.show-window")
        self._notifications[identifier] = notification

        def closed(current):
            if self._notifications.get(identifier) is current:
                self._notifications.pop(identifier, None)
                self.application.withdraw_notification(identifier)

        notification.connect("closed", closed)
        self.application.send_notification(identifier, native)
        return True
