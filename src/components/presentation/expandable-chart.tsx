"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";
import styles from "./expandable-chart.module.css";

/** Expands the mounted chart; its data and interaction state stay in place. */
export function ExpandableChart({ children, title, enabled = true, onEscape }: { children: ReactNode; title: string; enabled?: boolean; onEscape?: () => boolean }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!expanded || !frame.current) return;
    const chartFrame = frame.current;
    const returnFocus = trigger.current;
    const unlock = acquireBodyScrollLock(document.body);
    const siblings: { element: HTMLElement; inert: boolean }[] = [];
    let child: HTMLElement = frame.current;
    while (child.parentElement && child !== document.body) {
      for (const sibling of child.parentElement.children) {
        if (sibling !== child && sibling instanceof HTMLElement) {
          siblings.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      child = child.parentElement;
    }
    closeButton.current?.focus();
    function restoreFocusInside() {
      if (chartFrame.getAttribute("role") !== "dialog") return;
      const active = document.activeElement;
      if (!chartFrame.contains(active) || (active instanceof HTMLElement && active.matches(":disabled, [hidden]"))) {
        closeButton.current?.focus();
      }
    }
    document.addEventListener("focusin", restoreFocusInside);
    // Removing the focused control can move focus to body without a focusin event.
    const observer = new MutationObserver(restoreFocusInside);
    observer.observe(chartFrame, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden"] });
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", restoreFocusInside);
      for (const { element, inert } of siblings) element.inert = inert;
      unlock();
      returnFocus?.focus();
    };
  }, [expanded]);

  function containFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!expanded) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!onEscape?.()) setExpanded(false);
    }
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    )].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  if (!enabled) return <>{children}</>;

  return <div ref={frame} className={styles.frame} data-expanded={expanded || undefined}
    role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined}
    aria-labelledby={expanded ? titleId : undefined} onKeyDownCapture={containFocus}>
    {expanded ? <button className={styles.backdrop} tabIndex={-1} aria-label={t("닫기", "Close")} onClick={() => setExpanded(false)} /> : null}
    <div className={styles.toolbar}>
      <h2 id={titleId} hidden={!expanded}>{title}</h2>
      <button ref={trigger} hidden={expanded} type="button" className="varda-presentation-detail-trigger" onClick={() => setExpanded(true)}><span>{t("크게 보기", "Expand chart")}</span><Maximize2 size={15} aria-hidden="true" /></button>
      <button ref={closeButton} hidden={!expanded} type="button" className="varda-icon-button" aria-label={t("확대 차트 닫기", "Close expanded chart")} onClick={() => setExpanded(false)}><X size={20} /></button>
    </div>
    {children}
  </div>;
}
