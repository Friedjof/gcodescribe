import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { StrokeFontDocument, StrokeFontSummary } from "../api";

// Owns the stroke-font editing session: the list of saved fonts, the currently
// open document, and its dirty state. The backend is the source of truth; this
// hook holds the temporary editor state and persists explicitly via `save`.
export function useStrokeFont() {
  const [summaries, setSummaries] = useState<StrokeFontSummary[]>([]);
  const [current, setCurrentDoc] = useState<StrokeFontDocument | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshList = useCallback(
    () => api.listStrokeFonts().then((r) => setSummaries(r.strokeFonts)),
    []
  );

  useEffect(() => {
    refreshList().catch(() => undefined);
  }, [refreshList]);

  const create = useCallback(async (label: string) => {
    setBusy(true);
    try {
      const { strokeFont } = await api.createStrokeFont(label);
      setCurrentDoc(strokeFont);
      setDirty(false);
      await api.listStrokeFonts().then((r) => setSummaries(r.strokeFonts));
      return strokeFont;
    } finally {
      setBusy(false);
    }
  }, []);

  const open = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const { strokeFont } = await api.getStrokeFont(id);
      setCurrentDoc(strokeFont);
      setDirty(false);
      return strokeFont;
    } finally {
      setBusy(false);
    }
  }, []);

  const save = useCallback(async (document = current) => {
    if (!document) return null;
    setBusy(true);
    try {
      const { strokeFont } = await api.saveStrokeFont(document.id, document);
      setCurrentDoc(strokeFont);
      setDirty(false);
      await api.listStrokeFonts().then((r) => setSummaries(r.strokeFonts));
      return strokeFont;
    } finally {
      setBusy(false);
    }
  }, [current]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const { strokeFonts } = await api.deleteStrokeFont(id);
        setSummaries(strokeFonts);
        setCurrentDoc((doc) => (doc?.id === id ? null : doc));
        if (current?.id === id) setDirty(false);
      } finally {
        setBusy(false);
      }
    },
    [current]
  );

  // Apply an in-memory edit to the open document and mark it unsaved.
  const updateCurrent = useCallback((next: StrokeFontDocument) => {
    setCurrentDoc(next);
    setDirty(true);
  }, []);

  const close = useCallback(() => {
    setCurrentDoc(null);
    setDirty(false);
  }, []);

  return {
    summaries,
    current,
    dirty,
    busy,
    refreshList,
    create,
    open,
    save,
    remove,
    updateCurrent,
    close,
  };
}

export type UseStrokeFont = ReturnType<typeof useStrokeFont>;
