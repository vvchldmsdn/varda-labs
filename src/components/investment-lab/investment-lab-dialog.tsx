"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Info, Table2, X } from "lucide-react";

export function InvestmentLabDialog({
  title,
  label,
  children,
  icon = "info",
  size = "regular",
  compactLabel = false,
}: {
  title: string;
  label: string;
  children: ReactNode;
  icon?: "info" | "calendar" | "table";
  size?: "regular" | "wide";
  compactLabel?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const Icon =
    icon === "calendar" ? CalendarDays : icon === "table" ? Table2 : Info;

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        aria-label={label}
        title={label}
        className="inline-flex min-h-9 items-center gap-2 rounded px-2 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
        onClick={() => {
          ref.current?.showModal();
          setOpen(true);
        }}
        type="button"
      >
        <Icon aria-hidden="true" size={15} strokeWidth={1.6} />
        <span className={compactLabel ? "hidden sm:inline" : undefined}>{label}</span>
      </button>
      <dialog
        aria-labelledby={id}
        className={`varda-dialog fixed inset-0 m-auto max-h-[min(88dvh,850px)] w-[calc(100%_-_24px)] overflow-hidden p-0 ${size === "wide" ? "max-w-[1180px]" : "max-w-[760px]"}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) ref.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          ref.current?.close();
        }}
        onClose={() => setOpen(false)}
        ref={ref}
      >
        <div className="flex max-h-[min(88dvh,850px)] flex-col">
          <header className="varda-dialog-header flex shrink-0 items-center justify-between gap-4">
            <h2 className="text-base font-medium" id={id}>
              {title}
            </h2>
            <button
              aria-label="닫기"
              className="varda-icon-button"
              onClick={() => ref.current?.close()}
              title="닫기"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          <div className="varda-dialog-content min-h-0 overflow-y-auto overscroll-contain">
            {children}
          </div>
        </div>
      </dialog>
    </>
  );
}
