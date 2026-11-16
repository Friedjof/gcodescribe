# Guided editor tour

`tourModel.ts` defines the route, versioned local progress and viewport-bounded
popover placement. `TourProvider` coordinates workspace navigation and the real
setup/calibration views. `TourOverlay` observes semantic `data-tour` anchors and
renders a non-modal spotlight and keyboard-accessible controls.

- First-time, unconfirmed setup offers the tour. Confirmed projects are left
  alone unless an unfinished tour exists. Help can always open or replay it.
- Back/Next change the explanation and visible view. They never save a profile,
  mark setup complete, issue printer commands or start a plot. Those actions
  remain explicit in the underlying application.
- Setup and calibration actions can advance the explanation. Locked calibration
  tasks stay locked; their tab is highlighted with a prerequisite explanation.
- Settings, dialogs and active printer work suspend the overlay. Visiting a
  different workspace minimizes it; Resume deliberately returns to its step.
- Tour-only workspaces are temporarily visible. Saved tab preferences survive
  the tour. Finishing returns to setup and restores the actual pending task.
- Progress is stored under `gcs.tour.v1`. Corrupt or unavailable storage does not
  prevent use. Dismissal is remembered; an interrupted tour can resume.

Adding a step requires a model entry, a visible anchor and translated title/body.
Use a separate `anchor` when positioning beside a broad control group would hide
its actions. Keep presentation independent of device/setup state mutations.

Tests cover progress, resume/replay, workspace changes, printer/dialog suspension
and placement. Browser checks also cover real clicks, keyboard minimization,
hidden tabs, both themes and reduced motion at desktop sizes down to 1024×768.
