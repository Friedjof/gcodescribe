import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { state.resolve(false); setState(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  const respond = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const ConfirmNode = state ? (
    <div className="modal-backdrop" onPointerDown={() => respond(false)}>
      <div
        className="modal dialog-modal"
        role="alertdialog"
        aria-modal
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-body">
          <p className="dialog-message">{state.message}</p>
          <div className="dialog-actions">
            <button onClick={() => respond(false)}>{t("common.cancel")}</button>
            <button className="primary danger-btn" onClick={() => respond(true)}>
              {t("common.yes")}
            </button>
          </div>
        </div>
      </div>
    </div>
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
    <div className="modal-backdrop" onPointerDown={() => respond(null)}>
      <div
        className="modal dialog-modal"
        role="dialog"
        aria-modal
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-body">
          <p className="dialog-message">{state.message}</p>
          <input
            ref={inputRef}
            className="dialog-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") respond(value);
              if (e.key === "Escape") respond(null);
            }}
          />
          <div className="dialog-actions">
            <button onClick={() => respond(null)}>{t("common.cancel")}</button>
            <button className="primary" onClick={() => respond(value)}>
              {t("common.apply")}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { prompt, PromptNode };
}
