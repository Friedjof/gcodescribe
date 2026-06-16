import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Central, silent toast notifications. Messages stack in the top-right corner
// and auto-dismiss after a kind-dependent delay; errors linger longest. There
// is no sound — purely visual.

export type ToastKind = "ok" | "err" | "warn";

export interface ToastOptions {
  kind?: ToastKind;
  /** Visible time in ms; 0 keeps the toast until dismissed manually. */
  duration?: number;
}

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  duration: number;
}

interface ToastApi {
  notify: (message: string, opts?: ToastOptions) => number;
  success: (message: string, opts?: Omit<ToastOptions, "kind">) => number;
  error: (message: string, opts?: Omit<ToastOptions, "kind">) => number;
  warn: (message: string, opts?: Omit<ToastOptions, "kind">) => number;
  dismiss: (id: number) => void;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  ok: 4000,
  warn: 6000,
  err: 8000,
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, opts: ToastOptions = {}) => {
    const kind = opts.kind ?? "ok";
    const id = nextId.current++;
    const duration = opts.duration ?? DEFAULT_DURATION[kind];
    setToasts((list) => [...list, { id, kind, message, duration }]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      notify,
      success: (message, opts) => notify(message, { ...opts, kind: "ok" }),
      error: (message, opts) => notify(message, { ...opts, kind: "err" }),
      warn: (message, opts) => notify(message, { ...opts, kind: "warn" }),
      dismiss,
    }),
    [notify, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div className={`toast toast-${toast.kind}`} role="status">
      <span className="toast-msg">{toast.message}</span>
      <button className="toast-close" aria-label="×" onClick={() => onDismiss(toast.id)}>
        ×
      </button>
    </div>
  );
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used inside ToastProvider");
  return ctx;
}
