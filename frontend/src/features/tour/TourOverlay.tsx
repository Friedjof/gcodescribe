import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "../../components/Modal";
import EditorIcon from "../../components/editor/EditorIcon";
import { useI18n } from "../../i18n";
import {
  placeTourCard,
  TOUR_STEPS,
  type Rect,
  type TourStep,
} from "./tourModel";

function visibleTarget(name: string) {
  return (
    [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find(
      (element) =>
        element.getBoundingClientRect().width > 0 &&
        element.getBoundingClientRect().height > 0,
    ) ?? null
  );
}
function measureRect(element: HTMLElement | null): Rect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: Math.max(5, rect.left - 5),
    top: Math.max(5, rect.top - 5),
    width: Math.min(
      innerWidth - Math.max(5, rect.left - 5) - 5,
      rect.width + 10,
    ),
    height: Math.min(
      innerHeight - Math.max(5, rect.top - 5) - 5,
      rect.height + 10,
    ),
  };
}
export default function TourOverlay({
  welcome,
  step,
  current,
  resumable,
  paused,
  minimized,
  onStart,
  onRestart,
  onClose,
  onFinish,
  onBack,
  onNext,
  onMinimize,
  onRestore,
}: {
  welcome: boolean;
  step: TourStep | null;
  current: number;
  resumable: boolean;
  paused: boolean;
  minimized: boolean;
  onStart: () => void;
  onRestart: () => void;
  onClose: () => void;
  onFinish: () => void;
  onBack: () => void;
  onNext: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}) {
  const { t } = useI18n();
  const card = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const [layout, setLayout] = useState<{
    target: Rect | null;
    left: number;
    top: number;
    available: boolean;
    locked: boolean;
  }>({ target: null, left: 12, top: 70, available: false, locked: false });
  const [otherDialog, setOtherDialog] = useState(false);
  const suspended = paused || otherDialog;
  useEffect(() => {
    if (!step) return;
    const check = () =>
      setOtherDialog(
        !!document.querySelector(
          '[role="dialog"]:not([data-tour-card]), [role="alertdialog"]',
        ),
      );
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [step]);
  useLayoutEffect(() => {
    if (!step || minimized || suspended) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = visibleTarget(step.target),
          targetRect = measureRect(target);
        const anchor = measureRect(visibleTarget(step.anchor ?? step.target));
        const element = card.current;
        const position = placeTourCard(
          anchor,
          {
            width: element?.offsetWidth || 344,
            height: element?.offsetHeight || 300,
          },
          { width: innerWidth, height: innerHeight },
          step.side,
        );
        const next = {
          target: targetRect,
          ...position,
          available: !!target,
          locked: target?.matches(":disabled") ?? false,
        };
        setLayout((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        );
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.querySelector(".app") ?? document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "style", "class", "disabled"],
    });
    const resize = new ResizeObserver(update);
    resize.observe(document.body);
    if (card.current) resize.observe(card.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step, minimized, suspended]);
  useEffect(() => {
    if (!step || minimized || suspended) return;
    nextButton.current?.focus({ preventScroll: true });
  }, [step, minimized, suspended]);
  useEffect(() => {
    if (!step || suspended) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (minimized) onClose();
        else onMinimize();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [step, suspended, minimized, onClose, onMinimize]);
  useEffect(() => {
    if (!minimized || suspended) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(".tour-resume-pill")
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [minimized, suspended]);
  if (welcome && !paused)
    return (
      <Modal
        title={t("tour.welcome.title")}
        className="tour-welcome"
        onClose={onClose}
        footer={
          <>
            <button onClick={onClose}>{t("tour.later")}</button>
            {resumable && (
              <button onClick={onRestart}>{t("tour.restart")}</button>
            )}
            <button className="primary" onClick={onStart}>
              <EditorIcon name="play" size={16} />
              {t(resumable ? "tour.resume" : "tour.start")}
            </button>
          </>
        }
      >
        <div className="tour-welcome-mark">
          <EditorIcon name="draw" size={30} />
          <span>
            GCodeScribe <small>{t("tour.studio")}</small>
          </span>
        </div>
        <p>{t("tour.welcome.body")}</p>
        <ol className="tour-route">
          <li>
            <EditorIcon name="settings" size={17} />
            {t("tour.route.setup")}
          </li>
          <li>
            <EditorIcon name="measure" size={17} />
            {t("tour.route.calibration")}
          </li>
          <li>
            <EditorIcon name="pages" size={17} />
            {t("tour.route.page")}
          </li>
        </ol>
        <p className="tour-note">{t("tour.welcome.hint")}</p>
      </Modal>
    );
  if (!step || suspended) return null;
  if (minimized)
    return createPortal(
      <button type="button" className="tour-resume-pill" onClick={onRestore}>
        <EditorIcon name="help" size={17} />
        {t("tour.minimized", {
          current: current + 1,
          total: TOUR_STEPS.length,
        })}
        <EditorIcon name="up" size={15} />
      </button>,
      document.body,
    );
  return createPortal(
    <div className="app-tour-layer">
      {layout.target && (
        <div
          className="tour-spotlight"
          aria-hidden="true"
          style={layout.target}
        />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-labelledby="app-tour-title"
        aria-describedby="app-tour-description"
        data-tour-card
        className="tour-card"
        style={{ left: layout.left, top: layout.top }}
        key={step.id}
      >
        <div className="tour-card-top">
          <span className="tour-eyebrow">
            <EditorIcon name={step.icon} size={16} />
            {t("tour.step", { current: current + 1, total: TOUR_STEPS.length })}
          </span>
          <div>
            <button
              type="button"
              title={t("tour.minimize")}
              aria-label={t("tour.minimize")}
              onClick={onMinimize}
            >
              <EditorIcon name="down" size={15} />
            </button>
            <button
              type="button"
              title={t("tour.close")}
              aria-label={t("tour.close")}
              onClick={onClose}
            >
              <EditorIcon name="close" size={15} />
            </button>
          </div>
        </div>
        <h2 id="app-tour-title">{t(`tour.${step.id}.title`)}</h2>
        <p id="app-tour-description">{t(`tour.${step.id}.body`)}</p>
        {layout.locked && (
          <p className="tour-task-note">
            <EditorIcon name="help" size={14} />
            {t("tour.locked")}
          </p>
        )}
        {!layout.available && (
          <p role="status" className="tour-task-note">
            {t("tour.loading")}
          </p>
        )}
        <div className="tour-progress" aria-hidden="true">
          {TOUR_STEPS.map((item, i) => (
            <span
              key={item.id}
              className={
                i === current ? "current" : i < current ? "visited" : ""
              }
            />
          ))}
        </div>
        <footer>
          <button type="button" disabled={current === 0} onClick={onBack}>
            <EditorIcon name="previous" size={15} />
            {t("tour.back")}
          </button>
          <button
            ref={nextButton}
            type="button"
            className="primary"
            onClick={current === TOUR_STEPS.length - 1 ? onFinish : onNext}
          >
            {t(current === TOUR_STEPS.length - 1 ? "tour.finish" : "tour.next")}
            <EditorIcon
              name={current === TOUR_STEPS.length - 1 ? "check" : "next"}
              size={15}
            />
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
