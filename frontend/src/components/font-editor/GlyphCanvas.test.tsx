// @vitest-environment jsdom

import React, { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import GlyphCanvas from "./GlyphCanvas";
import { I18nProvider } from "../../i18n";
import type { Stroke, StrokeFontMetrics, StrokePoint } from "../../api";

const metrics: StrokeFontMetrics = {
  em: 1000,
  baseline: 0,
  xHeight: 460,
  capHeight: 700,
  ascender: 780,
  descender: -230,
  defaultAdvance: 560,
  wordSpacing: 280,
};

function installSvgGeometryMocks() {
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(SVGSVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ inverse: () => ({}) }),
  });
  Object.defineProperty(SVGSVGElement.prototype, "createSVGPoint", {
    configurable: true,
    value() {
      return {
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y };
        },
      };
    },
  });
}

function stroke(id: string, points: StrokePoint[]): Stroke {
  return { id, rawPoints: points, points };
}

function renderCanvas(props: Partial<React.ComponentProps<typeof GlyphCanvas>> = {}) {
  const defaults: React.ComponentProps<typeof GlyphCanvas> = {
    metrics,
    strokes: [],
    tool: "draw",
    selectedId: null,
    onSelectStroke: vi.fn(),
    onStrokeComplete: vi.fn(),
    onEraseStroke: vi.fn(),
    onMoveStroke: vi.fn(),
    playRequest: 0,
    onPlayingChange: vi.fn(),
  };
  return render(
    <I18nProvider>
      <GlyphCanvas {...defaults} {...props} />
    </I18nProvider>
  );
}

function pointer(target: Element, type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number) {
  fireEvent[type](target, {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "pointerUp" ? 0 : 1,
    pointerId: 1,
    pointerType: "pen",
    pressure: 0.5,
  });
}

beforeEach(() => {
  localStorage.clear();
  installSvgGeometryMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GlyphCanvas pointer tools", () => {
  it("emits exactly one completed stroke per pen lift under StrictMode", () => {
    const onStrokeComplete = vi.fn();
    const { container } = render(
      <StrictMode>
        <I18nProvider>
          <GlyphCanvas
            metrics={metrics}
            strokes={[]}
            tool="draw"
            selectedId={null}
            onSelectStroke={vi.fn()}
            onStrokeComplete={onStrokeComplete}
            onEraseStroke={vi.fn()}
            onMoveStroke={vi.fn()}
            playRequest={0}
            onPlayingChange={vi.fn()}
          />
        </I18nProvider>
      </StrictMode>
    );
    const svg = container.querySelector("svg")!;

    pointer(svg, "pointerDown", 100, 200);
    pointer(svg, "pointerMove", 140, 210);
    pointer(svg, "pointerUp", 140, 210);
    pointer(svg, "pointerDown", 220, 300);
    pointer(svg, "pointerMove", 260, 310);
    pointer(svg, "pointerUp", 260, 310);

    expect(onStrokeComplete).toHaveBeenCalledTimes(2);
    expect(onStrokeComplete.mock.calls[0][0]).toHaveLength(2);
    expect(onStrokeComplete.mock.calls[1][0]).toHaveLength(2);
  });

  it("erases the hit stroke", () => {
    const onEraseStroke = vi.fn();
    const { container } = renderCanvas({
      tool: "erase",
      strokes: [stroke("s1", [{ x: 100, y: 680 }, { x: 220, y: 680 }])],
      onEraseStroke,
    });
    const svg = container.querySelector("svg")!;

    pointer(svg, "pointerDown", 150, 200);

    expect(onEraseStroke).toHaveBeenCalledWith("s1");
  });

  it("moves the selected stroke by the last pointer offset", () => {
    const onMoveStroke = vi.fn();
    const onSelectStroke = vi.fn();

    function Harness() {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <I18nProvider>
          <GlyphCanvas
            metrics={metrics}
            strokes={[stroke("s1", [{ x: 100, y: 680 }, { x: 220, y: 680 }])]}
            tool="move"
            selectedId={selected}
            onSelectStroke={(id) => {
              onSelectStroke(id);
              setSelected(id);
            }}
            onStrokeComplete={vi.fn()}
            onEraseStroke={vi.fn()}
            onMoveStroke={onMoveStroke}
            playRequest={0}
            onPlayingChange={vi.fn()}
          />
        </I18nProvider>
      );
    }

    const { container } = render(<Harness />);
    const svg = container.querySelector("svg")!;

    pointer(svg, "pointerDown", 150, 200);
    pointer(svg, "pointerMove", 200, 230);
    pointer(svg, "pointerUp", 200, 230);

    expect(onSelectStroke).toHaveBeenCalledWith("s1");
    expect(onMoveStroke).toHaveBeenCalledWith("s1", 50, -30);
  });
});
