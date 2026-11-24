"""Forward workspace navigation before GTK consumes Ctrl+Shift+Tab as Backtab."""

from __future__ import annotations

from urllib.parse import urlsplit


class DesktopShortcuts:
    def __init__(self, view, origin: str, *, toolkit=None):
        if toolkit is None:
            from gi.repository import Gdk, Gtk

            toolkit = (Gdk, Gtk)
        self.gdk, self.gtk = toolkit
        self.view = view
        self.origin = urlsplit(origin)
        self.controller = self.gtk.EventControllerKey()
        self.controller.set_propagation_phase(self.gtk.PropagationPhase.CAPTURE)
        self.controller.connect("key-pressed", self._pressed)
        view.add_controller(self.controller)

    def _pressed(self, _controller, keyval, _keycode, state) -> bool:
        gdk = self.gdk
        modifiers = gdk.ModifierType
        relevant = state & (
            modifiers.CONTROL_MASK | modifiers.SHIFT_MASK | modifiers.ALT_MASK
            | modifiers.META_MASK | modifiers.SUPER_MASK | modifiers.HYPER_MASK
        )
        if relevant not in (
            modifiers.CONTROL_MASK, modifiers.CONTROL_MASK | modifiers.SHIFT_MASK
        ) or keyval not in (
            gdk.KEY_Tab, gdk.KEY_ISO_Left_Tab, gdk.KEY_Page_Up, gdk.KEY_Page_Down
        ):
            return False
        pages = {gdk.KEY_Page_Up: "PageUp", gdk.KEY_Page_Down: "PageDown"}
        if keyval in pages and relevant != modifiers.CONTROL_MASK:
            return False
        actual = urlsplit(self.view.get_uri() or "")
        if (actual.scheme, actual.netloc) != (self.origin.scheme, self.origin.netloc):
            return False
        backward = bool(state & modifiers.SHIFT_MASK) or keyval == gdk.KEY_ISO_Left_Tab
        shift = "true" if backward else "false"
        key = pages.get(keyval, "Tab")
        # Dispatch at the focused element so frontend modal, menu and input
        # handling remains authoritative. Consuming the original avoids a
        # second action or GTK moving focus out of WebKit for Backtab.
        script = (
            "(document.activeElement||document.body).dispatchEvent(new KeyboardEvent("
            f"'keydown',{{key:'{key}',code:'{key}',ctrlKey:true,shiftKey:"
            + shift + ",bubbles:true,cancelable:true}));"
        )
        self.view.evaluate_javascript(script, -1, None, None, None, None, None)
        return True
