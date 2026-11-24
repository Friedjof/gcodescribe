from enum import IntFlag
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from plotter.desktop.shortcuts import DesktopShortcuts


class Modifiers(IntFlag):
    SHIFT_MASK = 1
    CONTROL_MASK = 4
    ALT_MASK = 8
    SUPER_MASK = 64
    HYPER_MASK = 128
    META_MASK = 256


@pytest.fixture
def shortcuts():
    view, gtk = Mock(), Mock()
    view.get_uri.return_value = "http://127.0.0.1:8123/?desktop_build=test"
    gdk = SimpleNamespace(
        ModifierType=Modifiers, KEY_Tab=9, KEY_ISO_Left_Tab=65056,
        KEY_Page_Up=65365, KEY_Page_Down=65366,
    )
    handler = DesktopShortcuts(view, "http://127.0.0.1:8123", toolkit=(gdk, gtk))
    return handler, view, gtk


def test_workspace_keys_are_captured_before_webkit(shortcuts):
    handler, view, gtk = shortcuts
    handler.controller.set_propagation_phase.assert_called_once_with(gtk.PropagationPhase.CAPTURE)
    handler.controller.connect.assert_called_once_with("key-pressed", handler._pressed)
    view.add_controller.assert_called_once_with(handler.controller)


@pytest.mark.parametrize("key,modifiers,shift", [
    (9, Modifiers.CONTROL_MASK, "false"),
    (9, Modifiers.CONTROL_MASK | Modifiers.SHIFT_MASK, "true"),
    (65056, Modifiers.CONTROL_MASK | Modifiers.SHIFT_MASK, "true"),
])
def test_tab_and_native_backtab_forward_once_to_the_focused_element(
    shortcuts, key, modifiers, shift
):
    handler, view, _ = shortcuts
    assert handler._pressed(None, key, 23, modifiers)
    view.evaluate_javascript.assert_called_once()
    script = view.evaluate_javascript.call_args.args[0]
    assert "document.activeElement" in script
    assert "key:'Tab',code:'Tab',ctrlKey:true,shiftKey:" + shift in script
    assert "bubbles:true,cancelable:true" in script


@pytest.mark.parametrize("modifiers", [
    0, Modifiers.SHIFT_MASK, Modifiers.CONTROL_MASK | Modifiers.ALT_MASK,
    Modifiers.CONTROL_MASK | Modifiers.SUPER_MASK,
    Modifiers.CONTROL_MASK | Modifiers.META_MASK,
])
def test_other_focus_and_system_keys_are_not_intercepted(shortcuts, modifiers):
    handler, view, _ = shortcuts
    assert not handler._pressed(None, 9, 23, modifiers)
    view.evaluate_javascript.assert_not_called()


@pytest.mark.parametrize("uri", ["about:blank", "https://external.invalid/", "http://127.0.0.1:9234/"])
def test_loading_and_other_origins_do_not_receive_app_shortcuts(shortcuts, uri):
    handler, view, _ = shortcuts
    view.get_uri.return_value = uri
    assert not handler._pressed(None, 9, 23, Modifiers.CONTROL_MASK)
    view.evaluate_javascript.assert_not_called()


def test_unrelated_control_commands_keep_their_existing_handlers(shortcuts):
    handler, view, _ = shortcuts
    assert not handler._pressed(None, ord("s"), 39, Modifiers.CONTROL_MASK)
    view.evaluate_javascript.assert_not_called()


@pytest.mark.parametrize("key,name", [(65365, "PageUp"), (65366, "PageDown")])
def test_page_key_aliases_follow_the_same_frontend_navigation(shortcuts, key, name):
    handler, view, _ = shortcuts
    assert handler._pressed(None, key, 0, Modifiers.CONTROL_MASK)
    assert "key:'" + name + "'" in view.evaluate_javascript.call_args.args[0]


def test_shifted_page_keys_are_not_repurposed(shortcuts):
    handler, view, _ = shortcuts
    assert not handler._pressed(None, 65365, 0, Modifiers.CONTROL_MASK | Modifiers.SHIFT_MASK)
    view.evaluate_javascript.assert_not_called()
