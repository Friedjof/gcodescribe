import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import EditorIcon, { type EditorIconName } from "./EditorIcon";
export interface EditorMenuItem {
  id: string;
  label: string;
  action: () => void;
  disabled?: boolean | (() => boolean);
  icon?: EditorIconName;
  shortcut?: string;
  separator?: boolean;
  checked?: boolean;
  radio?: boolean;
}

/** Shared command menu: keyboard navigation, focus return and viewport-safe placement. */
export default function EditorMenu({
  label,
  children,
  items,
  active = true,
  className = "",
}: {
  label: string;
  children?: ReactNode;
  items: EditorMenuItem[];
  active?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const button = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    id = useId();
  const enabled = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
  const close = (focus = false) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  useEffect(() => {
    if (!active) close();
  }, [active]);
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const anchor = button.current.getBoundingClientRect(),
      popup = menu.current.getBoundingClientRect();
    setPosition({
      top:
        anchor.bottom + popup.height + 6 <= window.innerHeight
          ? anchor.bottom + 3
          : Math.max(4, anchor.top - popup.height - 3),
      left: Math.max(
        4,
        Math.min(anchor.left, window.innerWidth - popup.width - 4),
      ),
    });
    enabled()[0]?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!menu.current?.contains(node) && !button.current?.contains(node))
        close();
    };
    const changed = () => close();
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", changed);
    window.addEventListener("blur", changed);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", changed);
      window.removeEventListener("blur", changed);
    };
  }, [open]);
  const key = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    const choices = enabled(),
      current = choices.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (current + 1) % choices.length
        : event.key === "ArrowUp"
          ? (current - 1 + choices.length) % choices.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? choices.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    choices[next]?.focus();
  };
  return (
    <>
      <button
        type="button"
        ref={button}
        className={`editor-menu-trigger ${className}`}
        aria-label={label}
        title={label}
        disabled={!active}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children ?? label}
        <span aria-hidden="true" className="menu-chevron">
          ▾
        </span>
      </button>
      {open &&
        active &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            className="editor-command-menu"
            style={position}
            onKeyDown={key}
          >
            {items.map((item) => (
              <div
                key={item.id}
                className={item.separator ? "command-menu-group" : undefined}
              >
                <button
                  type="button"
                  role={
                    item.checked === undefined
                      ? "menuitem"
                      : item.radio
                        ? "menuitemradio"
                        : "menuitemcheckbox"
                  }
                  aria-checked={item.checked}
                  disabled={typeof item.disabled === "function" ? item.disabled() : item.disabled}
                  onClick={() => {
                    close(true);
                    item.action();
                  }}
                >
                  {item.checked ? (
                    <EditorIcon name="check" size={16} />
                  ) : item.icon ? (
                    <EditorIcon name={item.icon} size={16} />
                  ) : (
                    <span className="menu-icon-space" />
                  )}
                  <span>{item.label}</span>
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
