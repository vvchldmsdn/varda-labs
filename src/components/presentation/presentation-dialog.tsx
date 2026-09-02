"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";

export function PresentationDialog({
  children,
  description,
  label,
  title,
  wide = false,
}: {
  children: ReactNode;
  description?: string;
  label: string;
  title: string;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        className="varda-presentation-detail-trigger"
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
        onClose={() => setOpen(false)}
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
