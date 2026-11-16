import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useModalFocus } from "../hooks/useModalFocus";
import { useI18n } from "../i18n";

interface ConfirmState {
  message: string;
  resolve: (ok: boolean) => void;
}

export function useConfirm(): {
  confirm: (message: string) => Promise<boolean>;
  ConfirmNode: ReactNode;
} {
  const [state, setState] = useState<ConfirmState | null>(null);
  const { t } = useI18n();

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => setState({ message, resolve }));
  }, []);


  const respond = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const ConfirmNode = state ? (
    <ChoiceDialog role="alertdialog" onClose={() => respond(false)} label={state.message}>
      <div className="dialog-body">
        <p className="dialog-message">{state.message}</p>
        <div className="dialog-actions"><button onClick={() => respond(false)}>{t("common.cancel")}</button><button className="primary danger-btn" onClick={() => respond(true)}>{t("common.yes")}</button></div>
      </div>
    </ChoiceDialog>
  ) : null;

  return { confirm, ConfirmNode };
}

interface PromptState {
  message: string;
  defaultValue: string;
  resolve: (val: string | null) => void;
}

export function usePrompt(): {
  prompt: (message: string, defaultValue?: string) => Promise<string | null>;
  PromptNode: ReactNode;
} {
  const [state, setState] = useState<PromptState | null>(null);
  const [value, setValue] = useState("");
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const prompt = useCallback((message: string, defaultValue = ""): Promise<string | null> => {
    return new Promise((resolve) => {
      setValue(defaultValue);
      setState({ message, defaultValue, resolve });
    });
  }, []);

  useEffect(() => {
    if (state) {
      const id = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => clearTimeout(id);
    }
  }, [state]);

  const respond = (val: string | null) => {
    state?.resolve(val);
    setState(null);
  };

  const PromptNode = state ? (
    <ChoiceDialog role="dialog" onClose={() => respond(null)} label={state.message}>
      <div className="dialog-body">
        <label className="dialog-message" htmlFor={inputId}>{state.message}</label>
        <input ref={inputRef} id={inputId} className="dialog-input" type="text" autoComplete="off" data-bwignore="true" data-1p-ignore="true" data-lpignore="true" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); respond(value); } }}/>
        <div className="dialog-actions"><button onClick={() => respond(null)}>{t("common.cancel")}</button><button className="primary" onClick={() => respond(value)}>{t("common.apply")}</button></div>
      </div>
    </ChoiceDialog>
  ) : null;

  return { prompt, PromptNode };
}

/** Native-style prompts participate in the same focus/Escape stack as full dialogs. */
function ChoiceDialog({ role, label, onClose, children }: { role: "dialog" | "alertdialog"; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, onClose);
  return <div className="modal-backdrop" onPointerDown={onClose}><div ref={ref} tabIndex={-1} className="modal dialog-modal" role={role} aria-label={label} aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>{children}</div></div>;
}
