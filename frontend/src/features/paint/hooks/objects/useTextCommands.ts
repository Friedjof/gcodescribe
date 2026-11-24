import { useEffect, useRef, useState } from "react";
import { cachedPage, retainPage } from "../../../../api/pageEdits";
import { type Pt } from "../../lib/geometry";
import { keepsStrokeFeeds, objectStyle, randomTextSeed, textGeometryAsync } from "../../lib/sceneObjects";
import { type TextFont } from "../../lib/text";
import { geometryTask } from "../../lib/geometryTasks";
import type { ObjectCommandContext } from "./useObjectCommandContext";
export function useTextCommands(context: ObjectCommandContext) {
    const { page, selectedIds, defaultText, warnMissingGlyphs, setProcessing, commitAsync, fail } = context;
    const textSequence = useRef(new Map<string, number>());
    const sequence = useRef(0);
    const draftTextRef = useRef<string | null>(null);
    const textDraftTimer = useRef<number | undefined>(undefined);
    const [draftText, setDraftText] = useState<string | null>(null);
    const pendingDraft = useRef<{ commit: () => void; release: () => void } | null>(null);
    const pendingText = useRef(new Set<Promise<void>>());
    const finishDraft = () => {
        clearTimeout(textDraftTimer.current);
        const pending = pendingDraft.current;
        pendingDraft.current = null;
        if (pending) { pending.commit(); pending.release(); }
    };
    const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
    // Reset draft text whenever the selected object changes.
    useEffect(() => {
        const obj = selectedId
            ? page?.objects.find((o) => o.id === selectedId && o.type === "text")
            : null;
        clearTimeout(textDraftTimer.current);
        if (obj) {
            const txt = String(obj.data?.text ?? defaultText);
            draftTextRef.current = txt;
            setDraftText(txt);
        }
        else {
            draftTextRef.current = null;
            setDraftText(null);
        }
        return () => { void finishDraft(); };
    }, [page?.id, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
    const updateTextObject = (id: string, patch: Partial<{
        text: string;
        size: number;
        font: TextFont;
    }>) => {
        if (!page)
            return;
        const obj = page.objects.find((o) => o.id === id);
        if (!obj)
            return;
        const data = {
            text: String(obj.data?.text ?? defaultText),
            mode: "single-line",
            size: Number(obj.data?.size ?? 12),
            font: (obj.data?.font ?? "sans") as TextFont,
            // Keep a stable variant seed; older objects (and the default font) may not
            // have one yet, so mint it lazily the first time they are edited.
            seed: Number(obj.data?.seed ?? randomTextSeed()),
            ...patch,
        };
        const token = ++sequence.current;
        textSequence.current.set(`${page.id}:${id}`, token);
        const release = retainPage(page);
        setProcessing((n) => n + 1);
        const work = textGeometryAsync(data.text, data.size, data.font, defaultText, false, data.seed)
            .then(async ({ local, feeds, missing }) => {
            if (missing?.length)
                warnMissingGlyphs(missing);
            const style = objectStyle(obj);
            const geometry = await geometryTask<Pt[][]>({ kind: "style", lines: local, style });
            if (textSequence.current.get(`${page.id}:${id}`) !== token)
                return;
            commitAsync(page, new Map([[id, { before: obj, geometryOnly: true, after: {
                            ...obj, plotted: false, data: { ...data, basePolylines: local, style },
                            cachedPolylines: geometry, cachedFeeds: keepsStrokeFeeds(style) ? feeds : undefined,
                        } }]]));
        }).finally(() => {
            if (textSequence.current.get(`${page.id}:${id}`) === token) textSequence.current.delete(`${page.id}:${id}`);
            release(); setProcessing((n) => n - 1);
        });
        pendingText.current.add(work);
        void work.catch(fail).finally(() => pendingText.current.delete(work));
    };
    const onTextInput = (id: string, text: string) => {
        draftTextRef.current = text;
        setDraftText(text);
        clearTimeout(textDraftTimer.current);
        pendingDraft.current?.release();
        pendingDraft.current = page ? { commit: () => updateTextObject(id, { text }), release: retainPage(page) } : null;
        textDraftTimer.current = window.setTimeout(finishDraft, 350);
    };
    const onFontOrSizeChange = (id: string, patch: Partial<{
        text: string;
        size: number;
        font: TextFont;
    }>) => {
        clearTimeout(textDraftTimer.current);
        pendingDraft.current?.release();
        pendingDraft.current = null;
        const textPatch = draftTextRef.current !== null ? { text: draftTextRef.current } : {};
        updateTextObject(id, { ...textPatch, ...patch });
    };
    // Applies a text edit without triggering a backend render on every keystroke.
    // Returns true if there was a text object selected (so the caller can preventDefault).
    const editSelectedText = (edit: (text: string) => string): boolean => {
        if (!page || selectedIds.length !== 1)
            return false;
        const obj = page.objects.find((o) => o.id === selectedIds[0]);
        if (!obj || obj.type !== "text")
            return false;
        const current = draftTextRef.current ?? String(obj.data?.text ?? defaultText);
        const next = edit(current);
        onTextInput(obj.id, next);
        return true;
    };
    const flushPendingText = async () => {
        const hadDraft = !!pendingDraft.current;
        finishDraft();
        const current = page && (cachedPage(page.id) ?? page).objects.find(object => object.id === selectedId && object.type === "text");
        if (!hadDraft && current && draftTextRef.current !== null && String(current.data?.text ?? defaultText) !== draftTextRef.current)
            updateTextObject(current.id, { text: draftTextRef.current });
        while (pendingText.current.size) await Promise.all(pendingText.current);
        const saved = page && cachedPage(page.id)?.objects.find(object => object.id === selectedId && object.type === "text");
        if (saved && draftTextRef.current !== null && String(saved.data?.text ?? defaultText) !== draftTextRef.current)
            throw new Error(context.t("save.failed"));
    };
    return { draftText, updateTextObject, onTextInput, onFontOrSizeChange, editSelectedText, flushPendingText };
}
