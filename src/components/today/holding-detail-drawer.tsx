"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import styles from "./today-interaction.module.css";

export function HoldingDetailDrawer({ children, closeHref }: { children: ReactNode; closeHref: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<(() => void) | null>(null);
  const backdropPointerRef = useRef(false);
  const closingRef = useRef(false);
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const restore = () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      const trigger = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus
        : Array.from(document.querySelectorAll<HTMLElement>('[data-holding-detail-trigger="summary"]')).find(element => element.getClientRects().length > 0);
      trigger?.focus({ preventScroll: true });
    };
    restoreRef.current = restore;
    closingRef.current = false;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });
    return restore;
  }, []);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    restoreRef.current?.();
    router.push(closeHref, { scroll: false });
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-holding-dialog
      aria-labelledby="holding-detail-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement | SVGElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        backdropPointerRef.current = event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
      }}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (backdropPointerRef.current && event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) close();
        backdropPointerRef.current = false;
      }}
    >
      <div className={styles.dialogToolbar}>
        <span>{t("종목 상세", "Holding details")}</span>
        <button ref={closeButtonRef} type="button" onClick={close} className={styles.closeButton} aria-label={t("종목 상세 닫기", "Close holding details")}><span>{t("닫기", "Close")}</span><X size={18} aria-hidden="true"/></button>
      </div>
      <div className={styles.dialogBody} data-holding-dialog-body>{children}</div>
    </dialog>
  );
}
