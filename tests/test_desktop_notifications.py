from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from plotter.desktop.notifications import DesktopNotifications


class Permission:
    def __init__(self):
        self.allow = Mock()
        self.deny = Mock()


@pytest.fixture
def desktop(tmp_path):
    app, context, view, parent = Mock(), Mock(), Mock(), Mock()
    view.get_uri.return_value = "http://127.0.0.1:8123/"
    app.get_application_id.return_value = "info.noweck.gcodescribe"
    gio, gtk, webkit = Mock(), Mock(), Mock()
    webkit.NotificationPermissionRequest = Permission
    controller = DesktopNotifications(
        app,
        context,
        "http://127.0.0.1:8123",
        tmp_path / "notifications.json",
        toolkit=(gio, gtk, webkit),
    )
    controller.attach(view, parent)
    return SimpleNamespace(
        controller=controller,
        app=app,
        context=context,
        view=view,
        parent=parent,
        gio=gio,
        gtk=gtk,
        webkit=webkit,
    )


def test_permission_requires_explicit_approval_and_is_persisted(desktop):
    d = desktop
    request = Permission()
    assert d.controller._request_permission(d.view, request) is True
    request.allow.assert_not_called()
    dialog = d.gtk.AlertDialog.return_value
    dialog.choose_finish.return_value = 1
    dialog.choose.call_args.args[2](dialog, object())
    request.allow.assert_called_once()
    assert json.loads(d.controller.preferences.read_text()) == {"allowed": True}


def test_denial_or_dialog_error_does_not_grant_permission(desktop):
    d = desktop
    dialog = d.gtk.AlertDialog.return_value
    for error in (False, True):
        request = Permission()
        dialog.choose_finish.return_value = 0
        dialog.choose_finish.side_effect = RuntimeError("closed") if error else None
        d.controller._request_permission(d.view, request)
        dialog.choose.call_args.args[2](dialog, object())
        request.deny.assert_called_once()
        request.allow.assert_not_called()
    assert not d.controller.preferences.exists()


def test_permission_is_restored_for_the_new_local_port_only(desktop):
    d = desktop
    d.controller.preferences.write_text('{"allowed": true}')
    new = DesktopNotifications(
        d.app,
        d.context,
        "http://127.0.0.1:9234",
        d.controller.preferences,
        toolkit=(d.gio, d.gtk, d.webkit),
    )
    new._initialize_permissions(d.context)
    d.webkit.SecurityOrigin.new_for_uri.assert_called_once_with("http://127.0.0.1:9234")
    d.context.initialize_notification_permissions.assert_called_once_with(
        [d.webkit.SecurityOrigin.new_for_uri.return_value],
        [],
    )
    d.view.get_uri.return_value = "https://external.invalid/"
    request = Permission()
    assert new._request_permission(d.view, request) is True
    request.deny.assert_called_once()
    request.allow.assert_not_called()


def test_other_permission_requests_are_not_granted(desktop):
    assert desktop.controller._request_permission(desktop.view, Mock()) is False
    desktop.gtk.AlertDialog.assert_not_called()


def test_native_delivery_has_app_identity_and_focus_action(desktop):
    d = desktop
    d.controller.allowed = True
    note = Mock()
    note.get_tag.return_value = "plot-1"
    note.get_title.return_value = "GCodeScribe"
    note.get_body.return_value = "Plot complete"
    assert d.controller._show_notification(d.view, note) is True
    native = d.gio.Notification.new.return_value
    native.set_body.assert_called_once_with("Plot complete")
    d.gio.ThemedIcon.new.assert_called_once_with("info.noweck.gcodescribe")
    native.set_default_action.assert_called_once_with("app.show-window")
    d.app.send_notification.assert_called_once_with("plot-1", native)
    note.connect.call_args.args[1](note)
    d.app.withdraw_notification.assert_called_once_with("plot-1")


def test_replacing_a_tag_does_not_withdraw_the_new_notification(desktop):
    d = desktop
    d.controller.allowed = True
    old, new = Mock(), Mock()
    old.get_tag.return_value = new.get_tag.return_value = "plot-1"
    d.controller._show_notification(d.view, old)
    d.controller._show_notification(d.view, new)
    old.connect.call_args.args[1](old)
    d.app.withdraw_notification.assert_not_called()
    new.connect.call_args.args[1](new)
    d.app.withdraw_notification.assert_called_once_with("plot-1")


def test_delivery_is_blocked_without_consent_or_from_an_external_page(desktop):
    d = desktop
    d.controller._show_notification(d.view, Mock())
    d.app.send_notification.assert_not_called()
    d.controller.allowed = True
    d.view.get_uri.return_value = "https://external.invalid/"
    d.controller._show_notification(d.view, Mock())
    d.app.send_notification.assert_not_called()
