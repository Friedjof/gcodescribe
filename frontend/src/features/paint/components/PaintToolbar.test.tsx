// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import PaintToolbar from "./PaintToolbar";

vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

function renderToolbar(overrides: Partial<ComponentProps<typeof PaintToolbar>> = {}) {
  const onMoveToCalibration = vi.fn();
  render(<PaintToolbar
    page={{ id: "page", name: "Page", objects: [], grid: { step: 10, snap: false }, created: 0, modified: 0 }}
    desktop={true} liveState="idle" liveViewers={0} onToggleLive={vi.fn()}
    busy={false} sending={false} printerBusy={false} printerOnline={true} calibrating={false}
    pageBlocked={false} loadingPreview={false} hasSelection={false}
    onSetGrid={vi.fn()} onSetContinuous={vi.fn()} onCreateGcode={vi.fn()}
    onDirectPlot={vi.fn()} onPlotSelection={vi.fn()} onOpenColoring={vi.fn()}
    onOpenFullscreen={vi.fn()} onOpenInfo={vi.fn()} onOpenPressure={vi.fn()}
    onMoveToCalibration={onMoveToCalibration} {...overrides}
  />);
  return { button: screen.getByRole("button", { name: "paper.moveToCalib" }), onMoveToCalibration };
}

describe("calibration position shortcut", () => {
  it("opens manual pressure settings separately from the calibration move", () => {
    const onOpenPressure = vi.fn();
    const { onMoveToCalibration } = renderToolbar({ onOpenPressure });
    fireEvent.click(screen.getByRole("button", { name: "paper.pressure.title" }));
    expect(onOpenPressure).toHaveBeenCalledOnce();
    expect(onMoveToCalibration).not.toHaveBeenCalled();
  });
  it("allows calibrating the active profile even when the page cannot be plotted", () => {
    const { button, onMoveToCalibration } = renderToolbar({ pageBlocked: true });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("");
    expect(button.previousElementSibling).toContainElement(screen.getByRole("button", { name: "paint.directPlot" }));
    fireEvent.click(button);
    expect(onMoveToCalibration).toHaveBeenCalledOnce();
  });

  it.each([
    { printerOnline: false }, { printerBusy: true }, { busy: true },
    { sending: true }, { calibrating: true },
  ])("blocks calibration while unavailable: %j", (overrides) => {
    const { button, onMoveToCalibration } = renderToolbar(overrides);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onMoveToCalibration).not.toHaveBeenCalled();
  });
});

it("keeps offline export available while disabling direct plot", () => {
  renderToolbar({ printerOnline: false, page: { id:"page",name:"Page",objects:[{id:"object",type:"line"}],grid:{step:10,snap:false},created:0,modified:0 } });
  expect(screen.getByRole("button",{name:"paint.directPlot"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"paint.generateGcode"})).toBeEnabled();
});
