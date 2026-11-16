import { useRef, useId, type ReactNode } from "react";
import { useModalFocus } from "../hooks/useModalFocus";
import { useI18n } from "../i18n";

/** Centered overlay dialog. Closes on backdrop click or Escape. */
export default function Modal({
  title,
  onClose,
  children,
  footer,
  headerActions,
  className = "",
  bodyClassName = "",
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(dialog, onClose);

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        ref={dialog}
        tabIndex={-1}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {headerActions && <div className="modal-head-actions">{headerActions}</div>}
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </header>
        <div className={`modal-body ${bodyClassName}`.trim()}>{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
