// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FontEditor from "./FontEditor";
import { I18nProvider } from "../../i18n";
import { ToastProvider } from "../Toasts";

const mocks = vi.hoisted(() => ({
  undo: vi.fn(),
  redo: vi.fn(),
  replace: vi.fn(),
  load: vi.fn(),
  reset: vi.fn(),
  addStroke: vi.fn(),
  markSaved: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  updateCurrent: vi.fn(),
}));

vi.mock("../../fontEditor/useStrokeFont", () => ({
  useStrokeFont: () => ({
    current: {
      schemaVersion: 1,
      id: "stroke-test",
      label: "Test",
      kind: "stroke",
      units: "em",
      metrics: {
        em: 1000,
        baseline: 0,
        xHeight: 460,
        capHeight: 700,
        ascender: 780,
        descender: -230,
        defaultAdvance: 560,
        wordSpacing: 280,
      },
      glyphs: [],
      coverage: { targetSet: "latin-basic-en-v1" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    dirty: false,
    busy: false,
    create: mocks.create,
    open: mocks.open,
    save: mocks.save,
    remove: mocks.remove,
    updateCurrent: mocks.updateCurrent,
  }),
}));

vi.mock("../../fontEditor/useGlyphEditing", () => ({
  useGlyphEditing: () => ({
    strokes: [
      {
        id: "s1",
        rawPoints: [{ x: 100, y: 680 }, { x: 220, y: 680 }],
        points: [{ x: 100, y: 680 }, { x: 220, y: 680 }],
      },
    ],
    dirty: true,
    canUndo: true,
    canRedo: true,
    load: mocks.load,
    addStroke: mocks.addStroke,
    replace: mocks.replace,
    reset: mocks.reset,
    undo: mocks.undo,
    redo: mocks.redo,
    markSaved: mocks.markSaved,
  }),
}));

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

function renderEditor() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <FontEditor visible />
      </ToastProvider>
    </I18nProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  installSvgGeometryMocks();
  Object.values(mocks).forEach((mock) => mock.mockClear());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FontEditor keyboard shortcuts", () => {
  it("handles Ctrl+Z and Ctrl+Y globally", () => {
    renderEditor();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });

    expect(mocks.undo).toHaveBeenCalledTimes(1);
    expect(mocks.redo).toHaveBeenCalledTimes(1);
  });

  it("selects a moved stroke and deletes it with Delete", () => {
    const { container } = renderEditor();
    const svg = container.querySelector("svg")!;

    fireEvent.keyDown(window, { key: "m" });
    fireEvent.pointerDown(svg, {
      clientX: 150,
      clientY: 200,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: "pen",
    });
    fireEvent.keyDown(window, { key: "Delete" });

    expect(mocks.replace).toHaveBeenCalledWith([]);
  });

  it("does not switch glyphs when the discard dialog is cancelled", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    expect(screen.getByRole("dialog", { name: /discard changes/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }));

    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("switches glyphs after confirming the app discard dialog", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    fireEvent.click(screen.getByRole("button", { name: /discard changes/i }));

    expect(mocks.load).toHaveBeenCalledWith([]);
  });

  it("does not render a global font save button", () => {
    renderEditor();

    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("opens a writing test that includes the unsaved active glyph", () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: /writing test/i }));

    const preview = screen.getByRole("img", { name: /writing test preview/i });
    expect(screen.getByText(/current unsaved glyph/i)).toBeTruthy();
    expect(preview.querySelector("path")).toBeTruthy();
  });

  it("moves the current glyph from the alignment panel", () => {
    renderEditor();

    fireEvent.click(screen.getByTitle(/move right/i));

    expect(mocks.replace).toHaveBeenCalledWith([
      {
        id: "s1",
        rawPoints: [{ x: 120, y: 680 }, { x: 240, y: 680 }],
        points: [{ x: 120, y: 680 }, { x: 240, y: 680 }],
      },
    ]);
  });

  it("moves the current glyph with arrow keys", () => {
    renderEditor();

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(mocks.replace).toHaveBeenCalledWith([
      {
        id: "s1",
        rawPoints: [{ x: 112, y: 680 }, { x: 232, y: 680 }],
        points: [{ x: 112, y: 680 }, { x: 232, y: 680 }],
      },
    ]);
  });

  it("autosaves the font when saving a glyph advance", async () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText(/spacing after/i), { target: { value: "420" } });
    fireEvent.click(screen.getByRole("button", { name: /save glyph/i }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.updateCurrent.mock.calls[0][0].glyphs[0].variants[0].advance).toBe(420);
    expect(mocks.save.mock.calls[0][0].glyphs[0].variants[0].advance).toBe(420);
  });

  it("saves the spacing before a glyph", async () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText(/spacing before/i), { target: { value: "-80" } });
    fireEvent.click(screen.getByRole("button", { name: /save glyph/i }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0].glyphs[0].variants[0].spacingBefore).toBe(-80);
  });
});
