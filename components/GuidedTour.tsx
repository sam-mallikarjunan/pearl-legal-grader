"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleHelp, X } from "lucide-react";
import {
  ONBOARDING_RESET_EVENT,
  ONBOARDING_STORAGE_KEY,
  readTourChoice,
  saveTourChoice,
  type TourChoice,
} from "../lib/onboarding";
import "./guided-tour.css";

export interface GuidedTourStep {
  id: string;
  /** The first visible match is used, allowing desktop and mobile alternatives. */
  target: string;
  title: string;
  body: string;
}
interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}
interface Layout {
  top: number;
  left: number;
  width: number;
  target: Rect | null;
}
function visibleTarget(selector: string): HTMLElement | null {
  try {
    return (
      Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
        (element) => {
          if (element.closest('[hidden], [aria-hidden="true"]')) return false;
          const box = element.getBoundingClientRect(),
            style = getComputedStyle(element);
          return (
            box.width > 0 &&
            box.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        },
      ) ?? null
    );
  } catch {
    return null;
  }
}
function sameLayout(a: Layout | null, b: Layout) {
  return (
    !!a &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    JSON.stringify(a.target) === JSON.stringify(b.target)
  );
}
export default function GuidedTour({
  tourId,
  steps,
  enabled = true,
  autoOffer = true,
  title = "A quick look around",
  description = "See where to start and what to do next. You can end the tour at any time.",
  className = "",
  triggerLabel,
}: {
  tourId: string;
  steps: GuidedTourStep[];
  enabled?: boolean;
  autoOffer?: boolean;
  title?: string;
  description?: string;
  className?: string;
  triggerLabel?: string;
}) {
  const headingId = useId(),
    bodyId = useId();
  const [ready, setReady] = useState(false),
    [choice, setChoice] = useState<TourChoice | undefined>();
  const [open, setOpen] = useState(false),
    [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null),
    cardRef = useRef<HTMLDivElement>(null),
    headingRef = useRef<HTMLHeadingElement>(null),
    replayRef = useRef<HTMLButtonElement>(null),
    openerRef = useRef<HTMLElement | null>(null);
  const step = steps[index];
  useEffect(() => {
    const refresh = () => setChoice(readTourChoice(tourId));
    const storage = (event: StorageEvent) => {
      if (event.key === ONBOARDING_STORAGE_KEY || event.key === null) refresh();
    };
    refresh();
    setReady(true);
    window.addEventListener("storage", storage);
    window.addEventListener(ONBOARDING_RESET_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener(ONBOARDING_RESET_EVENT, refresh);
    };
  }, [tourId]);
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);
  useEffect(() => {
    if (!open || !enabled || !step) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const frame = requestAnimationFrame(() =>
      headingRef.current?.focus({ preventScroll: true }),
    );
    return () => {
      cancelAnimationFrame(frame);
      dialog.close();
      requestAnimationFrame(() => {
        if (document.querySelector("dialog[open]")) return;
        const opener = openerRef.current;
        if (
          opener?.isConnected &&
          !opener.closest('[hidden], [aria-hidden="true"]') &&
          opener.getBoundingClientRect().height > 0
        ) {
          opener.focus();
          opener.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "instant",
          });
        } else if (replayRef.current?.isConnected) {
          replayRef.current.focus();
          replayRef.current.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "instant",
          });
        } else {
          const main = document.querySelector<HTMLElement>("main");
          if (main) {
            if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
            main.focus({ preventScroll: true });
          }
        }
      });
    };
    // Step changes move the dialog's focus separately; keep one modal lifetime.
  }, [open, enabled, !!step]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      headingRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, index]);
  useLayoutEffect(() => {
    if (!open || !enabled || !step) return;
    let frame = 0,
      firstMeasure = true,
      observedTarget: HTMLElement | null = null;
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      if (!dialogRef.current?.open) {
        schedule();
        return;
      }
      const target = visibleTarget(step.target),
        card = cardRef.current;
      const vw = window.innerWidth,
        vh = window.innerHeight;
      const width = Math.min(380, Math.max(0, vw - 24));
      const height = Math.min(
        card?.getBoundingClientRect().height || 300,
        vh - 24,
      );
      if (target && firstMeasure) {
        const box = target.getBoundingClientRect();
        if (vw <= 600 && (box.bottom > vh - height - 32 || box.top < 12)) {
          window.scrollBy({
            top:
              box.top + box.height / 2 - Math.max(48, (vh - height - 24) / 2),
            behavior: "instant",
          });
        } else if (box.top < 12 || box.bottom > vh - 12)
          target.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant",
          });
      }
      firstMeasure = false;
      const box = target?.getBoundingClientRect();
      const anchor =
        box && box.bottom > 0 && box.top < vh && box.right > 0 && box.left < vw
          ? {
              left: Math.max(4, box.left - 6),
              top: Math.max(4, box.top - 6),
              width: Math.max(
                0,
                Math.min(vw - 4, box.right + 6) - Math.max(4, box.left - 6),
              ),
              height: Math.max(
                0,
                Math.min(vh - 4, box.bottom + 6) - Math.max(4, box.top - 6),
              ),
            }
          : null;
      let left = Math.max(12, (vw - width) / 2),
        top = Math.max(12, vh - height - 12);
      if (vw > 600 && anchor) {
        if (anchor.left + anchor.width + width + 28 <= vw) {
          left = anchor.left + anchor.width + 16;
          top = anchor.top;
        } else if (anchor.left - width - 16 >= 12) {
          left = anchor.left - width - 16;
          top = anchor.top;
        } else {
          left = anchor.left;
          top = anchor.top + anchor.height + 16;
          if (top + height > vh - 12) top = anchor.top - height - 16;
        }
      }
      left = Math.round(Math.max(12, Math.min(vw - width - 12, left)));
      top = Math.round(Math.max(12, Math.min(vh - height - 12, top)));
      const next = { top, left, width, target: anchor };
      setLayout((current) => (sameLayout(current, next) ? current : next));
      if (observedTarget !== target) {
        if (observedTarget) resize.unobserve(observedTarget);
        if (target) resize.observe(target);
        observedTarget = target;
      }
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    const mutation = new MutationObserver((records) => {
      if (records.some((record) => !dialogRef.current?.contains(record.target)))
        schedule();
    });
    mutation.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "open"],
    });
    resize.observe(document.documentElement);
    if (cardRef.current) resize.observe(cardRef.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, enabled, step?.id, step?.target]);
  function start(opener: HTMLElement) {
    if (
      !enabled ||
      !ready ||
      !steps.length ||
      document.querySelector("dialog[open]")
    )
      return;
    openerRef.current = opener;
    setIndex(0);
    setLayout(null);
    setOpen(true);
  }
  function remember(next: TourChoice) {
    setChoice(next);
    saveTourChoice(tourId, next);
  }
  function end(next: TourChoice) {
    remember(next);
    setOpen(false);
  }
  if (!enabled || !steps.length) return null;
  const offer = ready && autoOffer && !choice;
  return (
    <section
      className={`guided-tour-entry ${className}`}
      aria-label="Guided walkthrough"
    >
      {offer && (
        <div className="guided-tour-offer" data-guided-tour="offer">
          <div>
            <p className="guided-tour-kicker">New here?</p>
            <h2>{title}</h2>
            <p>{description}</p>
            <p className="guided-tour-privacy">
              Tour choices stay on this device. Taking a tour does not change
              your answers or permissions.
            </p>
          </div>
          <div className="guided-tour-entry-actions">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={(event) => start(event.currentTarget)}
            >
              Start tour <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button
              className="text-link"
              type="button"
              onClick={() => {
                remember("dismissed");
                requestAnimationFrame(() => replayRef.current?.focus());
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {!offer && (
        <button
          ref={replayRef}
          data-guided-tour="replay"
          type="button"
          className="text-link guided-tour-replay"
          disabled={!ready}
          onClick={(event) => start(event.currentTarget)}
        >
          <CircleHelp size={17} aria-hidden="true" />{" "}
          {triggerLabel ??
            (choice === "completed" ? "Replay tour" : "Take a quick tour")}
        </button>
      )}
      {open && step && (
        <dialog
          ref={dialogRef}
          className="guided-tour-dialog"
          data-guided-tour="dialog"
          data-guided-tour-target={step.target}
          data-has-target={!!layout?.target}
          aria-labelledby={headingId}
          aria-describedby={bodyId}
          onKeyDownCapture={(event) => {
            if (event.key !== "Tab") return;
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not([disabled])",
              ),
            ).filter((button) => button.getBoundingClientRect().height > 0);
            event.preventDefault();
            if (!controls.length) return;
            const current = controls.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next = event.shiftKey
              ? current > 0
                ? current - 1
                : controls.length - 1
              : (current + 1) % controls.length;
            controls[next].focus();
          }}
          onCancel={(event) => {
            event.preventDefault();
            end("dismissed");
          }}
          style={{
            left: layout?.left ?? 12,
            top: layout?.top ?? 12,
            width: layout?.width ?? "min(380px, calc(100vw - 24px))",
          }}
        >
          {layout?.target && (
            <div
              className="guided-tour-highlight"
              data-guided-tour="highlight"
              aria-hidden="true"
              style={layout.target}
            />
          )}
          <div ref={cardRef} className="guided-tour-card">
            <div className="guided-tour-top">
              <p className="guided-tour-kicker" aria-live="polite">
                Step {index + 1} of {steps.length}
              </p>
              <button
                className="guided-tour-close"
                type="button"
                aria-label="End tour"
                onClick={() => end("dismissed")}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <h2 ref={headingRef} id={headingId} tabIndex={-1}>
              {step.title}
            </h2>
            <p id={bodyId}>{step.body}</p>
            {layout && !layout.target && (
              <p className="guided-tour-unavailable" role="status">
                This part of the page isn’t visible in the current view. You can
                continue or end the tour.
              </p>
            )}
            <p className="guided-tour-keyboard">
              Use Tab to move between the tour buttons. Escape ends the tour.
            </p>
            <div className="guided-tour-controls">
              <button
                className="text-link"
                type="button"
                onClick={() => setIndex((value) => value - 1)}
                disabled={index === 0}
              >
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
              {index === steps.length - 1 ? (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => end("completed")}
                >
                  Finish tour <ArrowRight size={16} aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => setIndex((value) => value + 1)}
                >
                  Next <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}
