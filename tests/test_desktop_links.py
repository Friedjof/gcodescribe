from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from plotter.desktop.links import DesktopLinks


@pytest.fixture
def links():
    gtk, view, parent = Mock(), Mock(), Mock()
    webkit = SimpleNamespace(
        PolicyDecisionType=SimpleNamespace(NAVIGATION_ACTION=0, NEW_WINDOW_ACTION=1)
    )
    handler = DesktopLinks(view, parent, "http://127.0.0.1:8123", toolkit=(gtk, webkit))
    return handler, gtk, parent


@pytest.mark.parametrize("kind", [0, 1])
def test_external_sign_in_opens_browser_and_keeps_the_local_app(links, kind):
    handler, gtk, parent = links
    decision = Mock()
    uri = "https://auth.openai.com/codex/device"
    decision.get_navigation_action.return_value.get_request.return_value.get_uri.return_value = uri
    assert handler._decide(Mock(), decision, kind)
    decision.ignore.assert_called_once()
    gtk.UriLauncher.new.assert_called_once_with(uri)
    gtk.UriLauncher.new.return_value.launch.assert_called_once_with(parent, None, handler._opened)


@pytest.mark.parametrize("uri", [
    "http://127.0.0.1:8123/", "http://127.0.0.1:8123/api/pages",
    "blob:http://127.0.0.1:8123/example", "about:blank",
])
def test_internal_navigation_and_downloads_keep_webkit_handling(links, uri):
    handler, gtk, _ = links
    decision = Mock()
    decision.get_navigation_action.return_value.get_request.return_value.get_uri.return_value = uri
    assert not handler._decide(Mock(), decision, 0)
    decision.ignore.assert_not_called()
    gtk.UriLauncher.new.assert_not_called()


def test_response_policy_is_not_treated_as_navigation(links):
    handler, gtk, _ = links
    assert not handler._decide(Mock(), Mock(), 2)
    gtk.UriLauncher.new.assert_not_called()


def test_browser_launch_failure_does_not_crash_the_app(links):
    handler, gtk, _ = links
    decision = Mock()
    decision.get_navigation_action.return_value.get_request.return_value.get_uri.return_value = (
        "https://auth.openai.com/codex/device"
    )
    gtk.UriLauncher.new.return_value.launch.side_effect = RuntimeError("No portal")
    assert handler._decide(Mock(), decision, 1)
    launcher = Mock()
    launcher.launch_finish.side_effect = RuntimeError("Cancelled")
    handler._opened(launcher, Mock())
