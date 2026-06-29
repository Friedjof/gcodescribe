import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { useToasts } from "../Toasts";
import type { StrokePoint } from "../../api";
import { useStrokeFont } from "../../fontEditor/useStrokeFont";
import { useGlyphEditing } from "../../fontEditor/useGlyphEditing";
import {
  glyphStrokes,
  glyphSpacingBefore,
  glyphAdvance,
  hasGlyph,
  newStroke,
  removeGlyph,
  scaleStroke,
  translateStroke,
  upsertGlyph,
} from "../../fontEditor/glyphModel";
import type { CanvasTool } from "./GlyphCanvas";
import {
  STABILIZATION_PRESETS,
  stabilize,
  type StabilizationParams,
} from "../../fontEditor/stabilization";
import { boundsOf } from "../../fontEditor/strokeGeometry";
import { capturedKeys, requiredCoverage, validateKey } from "../../fontEditor/coverage";
import FontEditorHeader from "./FontEditorHeader";
import FontListDialog from "./FontListDialog";
import GlyphSidebar from "./GlyphSidebar";
import GlyphCanvas from "./GlyphCanvas";
import GlyphToolbar from "./GlyphToolbar";
import GlyphKeyInput from "./GlyphKeyInput";
import StabilizationPanel from "./StabilizationPanel";
import SymbolPickerDialog from "./SymbolPickerDialog";
import GlyphOverviewDialog from "./GlyphOverviewDialog";
import WritingTestDialog from "./WritingTestDialog";
import DiscardGlyphDialog from "./DiscardGlyphDialog";

interface PendingDiscardAction {
  run: () => void;
}

export default function FontEditor({ visible }: { visible: boolean }) {
  const { t } = useI18n();
  const toast = useToasts();
  const font = useStrokeFont();
  const editing = useGlyphEditing();
  const [listOpen, setListOpen] = useState(false);
  const [activeKey, setActiveKey] = useState("");
  const [playReq, setPlayReq] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [stabOpen, setStabOpen] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [writingTestOpen, setWritingTestOpen] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscardAction | null>(null);
  const [stabParams, setStabParams] = useState<StabilizationParams>(STABILIZATION_PRESETS.medium);
  const [tool, setTool] = useState<CanvasTool>("draw");
  const [selectedStroke, setSelectedStroke] = useState<string | null>(null);
  const [activeSpacingBefore, setActiveSpacingBefore] = useState(0);
  const [savedSpacingBefore, setSavedSpacingBefore] = useState(0);
  const [activeAdvance, setActiveAdvance] = useState(560);
  const [savedAdvance, setSavedAdvance] = useState(560);
  // While false, the advance auto-tracks the drawn width (so words get enough
  // room automatically); a manual slider/scale/align edit pins it.
  const [advanceTouched, setAdvanceTouched] = useState(false);

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  const currentGlyphDirty = editing.dirty || activeAdvance !== savedAdvance || activeSpacingBefore !== savedSpacingBefore;

  const confirmDiscardFontChanges = () =>
    !font.dirty || window.confirm(t("fontEditor.discardFontConfirm"));

  const withDiscardedGlyphChanges = (run: () => void): boolean => {
    if (!currentGlyphDirty) {
      run();
      return true;
    }
    setPendingDiscard({ run });
    return false;
  };

  const cancelDiscardGlyphChanges = () => setPendingDiscard(null);

  const discardGlyphChanges = () => {
    const action = pendingDiscard;
    setPendingDiscard(null);
    action?.run();
  };

  const saveGlyphAndContinue = async () => {
    const action = pendingDiscard;
    if (!action) return;
    const saved = await handleSaveGlyph();
    if (!saved) return;
    setPendingDiscard(null);
    action.run();
  };

  // Start a fresh editing buffer when the open font changes.
  const resetSession = () => {
    setActiveKey("");
    editing.load([]);
    setSelectedStroke(null);
    const advance = font.current?.metrics.defaultAdvance ?? 560;
    setActiveSpacingBefore(0);
    setSavedSpacingBefore(0);
    setActiveAdvance(advance);
    setSavedAdvance(advance);
    setAdvanceTouched(false);
  };

  const loadGlyph = (key: string) => {
    editing.load(glyphStrokes(font.current, key));
    const spacingBefore = glyphSpacingBefore(font.current, key) ?? 0;
    const savedAdv = glyphAdvance(font.current, key);
    const advance = savedAdv ?? font.current?.metrics.defaultAdvance ?? 560;
    setActiveSpacingBefore(spacingBefore);
    setSavedSpacingBefore(spacingBefore);
    setActiveAdvance(advance);
    setSavedAdvance(advance);
    // A glyph saved with an explicit advance keeps it; otherwise auto-track.
    setAdvanceTouched(savedAdv !== undefined);
  };

  const handleAdvanceChange = (v: number) => {
    setActiveAdvance(v);
    setAdvanceTouched(true);
  };

  // Selection only makes sense while moving; clear it otherwise.
  useEffect(() => {
    if (tool !== "move") setSelectedStroke(null);
  }, [tool]);

  const handleCreate = (label: string) => {
    withDiscardedGlyphChanges(() => {
      if (!confirmDiscardFontChanges()) return;
      font
        .create(label)
        .then(() => {
          resetSession();
          toast.success(t("fontEditor.created"));
        })
        .catch(fail);
    });
  };

  const handleOpen = (id: string) => {
    return withDiscardedGlyphChanges(() => {
      if (!confirmDiscardFontChanges()) return;
      font
        .open(id)
        .then(resetSession)
        .catch(fail);
      setListOpen(false);
    });
  };

  const handleDelete = (id: string) => {
    font.remove(id).catch(fail);
  };

  const selectGlyph = (key: string) => {
    if (key === activeKey.trim()) return;
    withDiscardedGlyphChanges(() => {
      setActiveKey(key);
      loadGlyph(key);
      setSelectedStroke(null);
    });
  };

  // Switching to a different key starts that glyph fresh: load its strokes (or a
  // blank canvas for a new key). Unsaved edits are kept (guarded by `dirty`) so
  // work isn't lost silently — use "New" to discard on purpose.
  useEffect(() => {
    if (!font.current || currentGlyphDirty) return;
    loadGlyph(activeKey.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, font.current?.id]);

  const handleNewGlyph = () => {
    withDiscardedGlyphChanges(() => {
      setActiveKey("");
      editing.load([]);
      const advance = font.current?.metrics.defaultAdvance ?? 560;
      setActiveSpacingBefore(0);
      setSavedSpacingBefore(0);
      setActiveAdvance(advance);
      setSavedAdvance(advance);
      setAdvanceTouched(false);
      setTool("draw");
      setSelectedStroke(null);
    });
  };

  const handleEraseStroke = (id: string) => {
    editing.replace(editing.strokes.filter((s) => s.id !== id));
  };

  const handleMoveStroke = (id: string, dx: number, dy: number) => {
    editing.replace(editing.strokes.map((s) => (s.id === id ? translateStroke(s, dx, dy) : s)));
  };

  const handleStroke = (raw: StrokePoint[]) => {
    const stroke = newStroke(raw, stabilize(raw, stabParams));
    // Record how `points` were derived so the stroke can be re-processed later.
    stroke.processing = { ...stabParams };
    editing.addStroke(stroke);
  };

  // Deliberately re-stabilize every stroke in the buffer from its raw points
  // with the current params (one undoable edit). Existing saved glyphs are not
  // touched until re-saved.
  const reprocessStrokes = () => {
    editing.replace(
      editing.strokes.map((s) => ({
        ...s,
        points: stabilize(s.rawPoints, stabParams),
        processing: { ...stabParams },
      }))
    );
  };

  const key = activeKey.trim();
  const glyphExists = !!font.current && hasGlyph(font.current, key);
  const canSaveGlyph =
    !!font.current &&
    validateKey(activeKey).ok &&
    editing.strokes.length > 0 &&
    currentGlyphDirty;
  const coverage = requiredCoverage(font.current);
  const em = font.current?.metrics.em ?? 1000;
  // Width the drawn strokes actually occupy, used to size word advances.
  const contentBounds = boundsOf(
    editing.strokes.flatMap((s) => (s.points.length ? s.points : s.rawPoints))
  );
  const contentRight = contentBounds ? contentBounds.xMax : 0;
  const suggestedAdvance = Math.round(contentRight + em * 0.08);
  const minAdvance = Math.round(em * 0.15);
  // The slider must reach past the widest content (whole words can be far wider
  // than a single em), so grow the ceiling with the drawn glyph.
  const maxAdvance = Math.max(Math.round(em * 1.4), Math.round(suggestedAdvance + em * 0.3));
  const minSpacingBefore = -Math.round(em * 0.15);
  const maxSpacingBefore = Math.round(em * 1.4);

  // Grow the advance to the drawn width until the user pins it manually, so a
  // word key gets enough trailing room without fiddling with the slider. Only
  // ever grows (to clear overlap) — it never shrinks a glyph that already fits,
  // so opening normal glyphs doesn't mark them dirty.
  useEffect(() => {
    if (!font.current || advanceTouched || !contentBounds) return;
    const suggested = Math.max(minAdvance, Math.min(maxAdvance, suggestedAdvance));
    if (suggested > activeAdvance + 1) setActiveAdvance(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.strokes, advanceTouched]);

  const handleSaveGlyph = async () => {
    if (!font.current || key === "" || editing.strokes.length === 0) return false;
    const nextDoc = upsertGlyph(font.current, key, editing.strokes, activeAdvance, activeSpacingBefore);
    font.updateCurrent(nextDoc);
    try {
      await font.save(nextDoc);
      setSavedSpacingBefore(activeSpacingBefore);
      setSavedAdvance(activeAdvance);
      editing.markSaved();
      toast.success(t("fontEditor.glyphSaved"));
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const handleDeleteGlyph = () => {
    if (!font.current || !glyphExists) return;
    font.updateCurrent(removeGlyph(font.current, key));
    editing.load([]);
    const advance = font.current.metrics.defaultAdvance;
    setActiveSpacingBefore(0);
    setSavedSpacingBefore(0);
    setActiveAdvance(advance);
    setSavedAdvance(advance);
    setAdvanceTouched(false);
    setSelectedStroke(null);
  };

  const handleMoveGlyph = (dx: number, dy: number) => {
    editing.replace(editing.strokes.map((s) => translateStroke(s, dx, dy)));
  };

  const handleScaleGlyph = (factor: number) => {
    const pts = editing.strokes.flatMap((s) => (s.points.length ? s.points : s.rawPoints));
    const b = boundsOf(pts);
    const origin = { x: b ? (b.xMin + b.xMax) / 2 : 0, y: font.current?.metrics.baseline ?? 0 };
    editing.replace(editing.strokes.map((s) => scaleStroke(s, factor, origin)));
    setActiveAdvance((v) => Math.max(minAdvance, Math.min(maxAdvance, Math.round(v * factor))));
    setAdvanceTouched(true);
  };

  const handleAutoAlignGlyph = () => {
    if (!font.current) return;
    const pts = editing.strokes.flatMap((s) => (s.points.length ? s.points : s.rawPoints));
    const b = boundsOf(pts);
    if (!b) return;
    const leftMargin = Math.round(font.current.metrics.em * 0.05);
    const rightMargin = Math.round(font.current.metrics.em * 0.08);
    const descenderKey = /^[gjpqy]$/.test(key);
    const targetBottom = descenderKey ? Math.round(font.current.metrics.descender * 0.65) : font.current.metrics.baseline;
    const dx = leftMargin - b.xMin;
    const dy = targetBottom - b.yMin;
    editing.replace(editing.strokes.map((s) => translateStroke(s, dx, dy)));
    setActiveAdvance(Math.max(minAdvance, Math.min(maxAdvance, Math.round(b.xMax - b.xMin + leftMargin + rightMargin))));
    setAdvanceTouched(true);
  };

  // Editor-wide keyboard shortcuts. Active only while the tab is visible and the
  // focus isn't in a text field, so typing keys/labels still works normally.
  useEffect(() => {
    if (!visible || !font.current) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        editing.undo();
      } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        editing.redo();
      } else if (mod && k === "s") {
        e.preventDefault();
        if (canSaveGlyph) handleSaveGlyph();
      } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && editing.strokes.length > 0 && !(tool === "move" && selectedStroke)) {
        e.preventDefault();
        const step = e.shiftKey ? (font.current?.metrics.em ?? 1000) * 0.04 : e.altKey ? (font.current?.metrics.em ?? 1000) * 0.004 : (font.current?.metrics.em ?? 1000) * 0.012;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
        handleMoveGlyph(dx, dy);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedStroke) {
        e.preventDefault();
        handleEraseStroke(selectedStroke);
        setSelectedStroke(null);
      } else if (!mod && k === "d") {
        setTool("draw");
      } else if (!mod && k === "e") {
        setTool("erase");
      } else if (!mod && k === "m") {
        setTool("move");
      } else if (!mod && k === "p") {
        setPlayReq((n) => n + 1);
      } else if (e.key === "Escape") {
        setSelectedStroke(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <section className="font-editor" aria-hidden={!visible}>
      <FontEditorHeader
        hasCurrent={!!font.current}
        currentLabel={font.current?.label ?? null}
        dirty={font.dirty || currentGlyphDirty}
        busy={font.busy}
        onCreate={handleCreate}
        onOpenList={() => setListOpen(true)}
      />

      {font.current ? (
        <div className="fe-body">
          <GlyphSidebar
            glyphs={font.current.glyphs}
            activeKey={key}
            coverage={coverage}
            onSelect={selectGlyph}
            onOpenOverview={() => setOverviewOpen(true)}
          />
          <GlyphCanvas
            metrics={font.current.metrics}
            strokes={editing.strokes}
            tool={tool}
            selectedId={selectedStroke}
            onSelectStroke={setSelectedStroke}
            onStrokeComplete={handleStroke}
            onEraseStroke={handleEraseStroke}
            onMoveStroke={handleMoveStroke}
            playRequest={playReq}
            onPlayingChange={setIsPlaying}
          />
          <GlyphToolbar
            tool={tool}
            canUndo={editing.canUndo}
            canRedo={editing.canRedo}
            hasStrokes={editing.strokes.length > 0}
            glyphExists={glyphExists}
            isPlaying={isPlaying}
            onToolChange={setTool}
            onUndo={editing.undo}
            onRedo={editing.redo}
            onReset={editing.reset}
            onDeleteGlyph={handleDeleteGlyph}
            onPlayback={() => setPlayReq((n) => n + 1)}
            onStabilization={() => setStabOpen(true)}
            onWritingTest={() => setWritingTestOpen(true)}
            spacingBefore={activeSpacingBefore}
            advance={activeAdvance}
            minSpacingBefore={minSpacingBefore}
            maxSpacingBefore={maxSpacingBefore}
            minAdvance={minAdvance}
            maxAdvance={maxAdvance}
            onMoveGlyph={handleMoveGlyph}
            onScaleGlyph={handleScaleGlyph}
            onAutoAlignGlyph={handleAutoAlignGlyph}
            onSpacingBeforeChange={setActiveSpacingBefore}
            onAdvanceChange={handleAdvanceChange}
          />
        </div>
      ) : (
        <div className="fe-empty">
          <p className="fe-empty-title">{t("fontEditor.empty")}</p>
          <p className="muted">{t("fontEditor.emptyHint")}</p>
        </div>
      )}

      <GlyphKeyInput
        value={activeKey}
        onChange={setActiveKey}
        onSaveGlyph={handleSaveGlyph}
        onOpenSymbols={() => setSymbolsOpen(true)}
        onNewGlyph={handleNewGlyph}
        canSave={canSaveGlyph}
        disabled={!font.current}
      />

      {listOpen && (
        <FontListDialog
          fonts={font.summaries}
          onOpen={handleOpen}
          onDelete={handleDelete}
          onClose={() => setListOpen(false)}
        />
      )}

      {stabOpen && (
        <StabilizationPanel
          params={stabParams}
          onChange={setStabParams}
          onReprocess={reprocessStrokes}
          hasStrokes={editing.strokes.length > 0}
          onClose={() => setStabOpen(false)}
        />
      )}

      {symbolsOpen && (
        <SymbolPickerDialog
          capturedKeys={capturedKeys(font.current)}
          onPick={selectGlyph}
          onClose={() => setSymbolsOpen(false)}
        />
      )}

      {overviewOpen && font.current && (
        <GlyphOverviewDialog
          doc={font.current}
          onPick={selectGlyph}
          onClose={() => setOverviewOpen(false)}
        />
      )}

      {writingTestOpen && font.current && (
        <WritingTestDialog
          doc={font.current}
          activeKey={key}
          activeStrokes={editing.strokes}
          activeSpacingBefore={activeSpacingBefore}
          activeAdvance={activeAdvance}
          minSpacingBefore={minSpacingBefore}
          maxSpacingBefore={maxSpacingBefore}
          minAdvance={minAdvance}
          maxAdvance={maxAdvance}
          onMoveGlyph={handleMoveGlyph}
          onScaleGlyph={handleScaleGlyph}
          onAutoAlignGlyph={handleAutoAlignGlyph}
          onSpacingBeforeChange={setActiveSpacingBefore}
          onAdvanceChange={handleAdvanceChange}
          onSelectGlyph={selectGlyph}
          onSaveGlyph={handleSaveGlyph}
          canSaveGlyph={canSaveGlyph}
          onClose={() => setWritingTestOpen(false)}
        />
      )}

      {pendingDiscard && (
        <DiscardGlyphDialog
          onCancel={cancelDiscardGlyphChanges}
          onDiscard={discardGlyphChanges}
          onSaveAndContinue={saveGlyphAndContinue}
          canSave={canSaveGlyph}
        />
      )}
    </section>
  );
}
