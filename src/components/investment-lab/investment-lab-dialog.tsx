"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Info, Table2, X } from "lucide-react";

export function InvestmentLabDialog({
  title,
  label,
  children,
  icon = "info",
  size = "regular",
}: {
  title: string;
  label: string;
  children: ReactNode;
  icon?: "info" | "calendar" | "table";
  size?: "regular" | "wide";
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
        className="inline-flex min-h-9 items-center gap-2 rounded px-2 text-xs text-[#66746c] transition-colors hover:bg-[#eaf0eb] hover:text-[#203b31] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#438574]"
        onClick={() => {
          ref.current?.showModal();
          setOpen(true);
        }}
        type="button"
      >
        <Icon aria-hidden="true" size={15} strokeWidth={1.6} />
        {label}
      </button>
      <dialog
        aria-labelledby={id}
        className={`fixed inset-0 m-auto max-h-[min(88dvh,850px)] w-[calc(100%_-_24px)] overflow-hidden rounded-lg border border-[#d6ded7] bg-[#fafbf8] p-0 text-[#1d2720] shadow-xl backdrop:bg-[#17231d]/25 backdrop:backdrop-blur-sm ${size === "wide" ? "max-w-[1180px]" : "max-w-[760px]"}`}
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
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dde3dc] px-5 py-4 sm:px-7">
            <h2 className="text-base font-medium" id={id}>
              {title}
            </h2>
            <button
              aria-label="닫기"
              className="grid size-9 shrink-0 place-items-center rounded-md text-[#67736b] hover:bg-[#eaf0eb] focus-visible:outline-2 focus-visible:outline-[#438574]"
              onClick={() => ref.current?.close()}
              title="닫기"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-7">
            {children}
          </div>
        </div>
      </dialog>
    </>
  );
}
