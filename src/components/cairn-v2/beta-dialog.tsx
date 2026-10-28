"use client";
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./beta.module.css";
import tokens from "./ui/tokens.module.css";
import motionStyles from "./dialog-motion.module.css";
import { dialogMotion, panelTransformAtRect } from "./dialog-motion";
import { useBetaPreferences } from "./beta-provider";

export type ExpansionOrigin = { rect: DOMRect; trigger: HTMLElement };
let lockCount = 0;
let savedOverflow = "";
let savedPadding = "";
function lockBackground() {
  if (lockCount++ === 0) {
    savedOverflow = document.body.style.overflow;
    savedPadding = document.body.style.paddingRight;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gutter) document.body.style.paddingRight = `${gutter}px`;
  }
  return () => {
    if (--lockCount === 0) {
      document.body.style.overflow = savedOverflow;
      document.body.style.paddingRight = savedPadding;
    }
  };
}

export function BetaDialog({
  children,
  label,
  origin,
  onClosed,
  popover = false,
}: {
  children: ReactNode;
  label: string;
  origin: ExpansionOrigin;
  onClosed: () => void;
  popover?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const animationsRef = useRef<Animation[]>([]);
  const closingRef = useRef(false);
  const closedRef = useRef(false);
  const closeRef = useRef(onClosed);
  const finishCloseRef = useRef<(() => void) | null>(null);
  const { reduceEffects } = useBetaPreferences();
  const cancelAnimations = useCallback(() => {
    for (const animation of animationsRef.current) {
      animation.onfinish = null;
      animation.cancel();
    }
    animationsRef.current = [];
    if (panelRef.current) panelRef.current.style.willChange = "";
  }, []);
  useLayoutEffect(() => {
    closeRef.current = onClosed;
  }, [onClosed]);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const panel = panelRef.current;
    const dialog = dialogRef.current;
    const scrim = scrimRef.current;
    if (!panel || !dialog || !scrim) return;
    const finish = () => {
      if (closedRef.current) return;
      closedRef.current = true;
      // Hide before cancel/unmount so no frame can reveal the full-size panel again.
      dialog.style.visibility = "hidden";
      dialog.close();
      closeRef.current();
    };
    finishCloseRef.current = finish;
    const current = {
      transform: getComputedStyle(panel).transform,
      opacity: getComputedStyle(panel).opacity,
    };
    const currentScrimOpacity = getComputedStyle(scrim).opacity;
    cancelAnimations();
    if (reduceEffects || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return finish();
    const target = panel.getBoundingClientRect();
    const rect = origin.trigger.isConnected
      ? (origin.trigger.closest("[data-beta-card]")?.getBoundingClientRect() ?? origin.rect)
      : origin.rect;
    const timing = popover ? dialogMotion.popoverClose : dialogMotion.close;
    panel.style.willChange = "transform, opacity";
    const panelAnimation = panel.animate(
      [current, { transform: panelTransformAtRect(target, rect), opacity: 0 }],
      { ...timing, fill: "forwards" },
    );
    const scrimAnimation = scrim.animate([{ opacity: currentScrimOpacity }, { opacity: 0 }], {
      ...timing,
      fill: "forwards",
    });
    animationsRef.current = [panelAnimation, scrimAnimation];
    panelAnimation.onfinish = finish;
  }, [cancelAnimations, origin, popover, reduceEffects]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const panel = panelRef.current!;
    const scrim = scrimRef.current!;
    closingRef.current = false;
    closedRef.current = false;
    const unlock = lockBackground();
    dialog.style.visibility = "hidden";
    dialog.showModal();
    const measure = () => {
      const mobile = window.innerWidth < 700;
      const width = popover
        ? Math.min(362, window.innerWidth - 24)
        : Math.min(label === "히스토리" ? 1248 : 1200, window.innerWidth - (mobile ? 24 : 192));
      const height = popover
        ? Math.min(415, window.innerHeight - 24)
        : Math.min(744, window.innerHeight - (mobile ? 24 : 100));
      const left = popover
        ? Math.max(12, Math.min(origin.rect.left, window.innerWidth - width - 12))
        : (window.innerWidth - width + (mobile ? 0 : 80)) / 2;
      const top = popover
        ? Math.max(12, Math.min(origin.rect.bottom + 10, window.innerHeight - height - 12))
        : (window.innerHeight - height) / 2;
      Object.assign(panel.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      panel.style.setProperty("--cairn-v2-content-width", `${width}px`);
      panel.style.setProperty("--cairn-v2-content-height", `${height}px`);
    };
    measure();
    const target = panel.getBoundingClientRect();
    if (!reduceEffects && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timing = popover ? dialogMotion.popoverOpen : dialogMotion.open;
      panel.style.willChange = "transform, opacity";
      const panelAnimation = panel.animate(
        [
          { transform: panelTransformAtRect(target, origin.rect), opacity: 0.3 },
          { transform: "none", opacity: 1 },
        ],
        timing,
      );
      const scrimAnimation = scrim.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      animationsRef.current = [panelAnimation, scrimAnimation];
      panelAnimation.onfinish = () => {
        panel.style.willChange = "";
      };
    }
    dialog.style.visibility = "";
    panel.querySelector<HTMLElement>("[data-dialog-close]")?.focus({ preventScroll: true });
    const resize = () => {
      cancelAnimations();
      if (closingRef.current) finishCloseRef.current?.();
      else measure();
    };
    window.addEventListener("resize", resize);
    return () => {
      // React can clean up during navigation as well as after the closing animation.
      dialog.style.visibility = "hidden";
      cancelAnimations();
      window.removeEventListener("resize", resize);
      dialog.close();
      unlock();
      origin.trigger.focus({ preventScroll: true });
    };
    // Mount once per dialog. Scope and selection can change without restarting motion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (!reduceEffects && !preference.matches) return;
      if (closingRef.current) finishCloseRef.current?.();
      cancelAnimations();
    };
    apply();
    preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, [cancelAnimations, reduceEffects]);

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.scope} ${tokens.scope} ${motionStyles.motionDialog}`}
      data-reduced={reduceEffects}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "a[href],button,input,select,textarea,summary,[tabindex]",
          ),
        ).filter(
          (item) =>
            !item.matches(':disabled,[hidden],[tabindex="-1"]') &&
            !item.closest("[inert]") &&
            item.getClientRects().length > 0,
        );
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div ref={scrimRef} className={motionStyles.scrim} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`${popover ? styles.glassPanel : styles.paperPanel} ${motionStyles.panel}`}
        data-beta-panel
      >
        <div className={styles.panelClip}>
          <button
            className={styles.close}
            type="button"
            aria-label={`${label} 닫기`}
            onClick={close}
            data-dialog-close
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cairn-v2/figma/75-108-83e03.svg" width="16" height="16" alt="" />
          </button>
          <div className={styles.panelScroll}>{children}</div>
        </div>
      </div>
    </dialog>
  );
}
