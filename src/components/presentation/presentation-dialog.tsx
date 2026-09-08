"use client";

import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";

export function PresentationDialog({
  children,
  description,
  label,
  title,
  triggerClassName,
  wide = false,
}: {
  children: ReactNode;
  description?: string;
  label: ReactNode;
  title: string;
  triggerClassName?: string;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    return acquireBodyScrollLock(document.body);
  }, [open]);

  function close() {
    dialogRef.current?.close();
  }

  function keepFocusInside(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return (
    <>
      <button
        className={`varda-presentation-detail-trigger ${triggerClassName ?? ""}`}
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
        type="button"
      >
        <span>{label}</span>
        <Maximize2 aria-hidden="true" size={15} strokeWidth={1.6} />
      </button>
      <dialog
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        className={`varda-dialog varda-presentation-dialog ${wide ? "varda-presentation-dialog-wide" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) setOpen(false);
        }}
        onKeyDown={keepFocusInside}
        ref={dialogRef}
      >
        <div className="varda-presentation-dialog-shell">
          <header className="varda-dialog-header flex shrink-0 items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="varda-kicker">DETAIL VIEW</p>
              <h2 className="mt-2 text-xl font-medium" id={titleId}>
                {title}
              </h2>
              {description ? (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]" id={descriptionId}>
                  {description}
                </p>
              ) : null}
            </div>
            <button
              aria-label="닫기"
              autoFocus
              className="varda-icon-button"
              onClick={close}
              title="닫기"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          <div className="varda-dialog-content varda-presentation-dialog-content">
            {children}
          </div>
        </div>
      </dialog>
    </>
  );
}
