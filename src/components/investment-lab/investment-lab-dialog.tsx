"use client";

import { useLabI18n } from "./lab-text";
import { labEnglish } from "./lab-copy";
import { LocalizedElement } from "@/components/i18n/localized-element";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Info, Table2, X } from "lucide-react";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";

export function InvestmentLabDialog({
  title,
  titleEn,
  label,
  labelEn,
  children,
  icon = "info",
  size = "regular",
  compactLabel = false,
}: {
  title: string;
  titleEn?: string;
  label: string;
  labelEn?: string;
  children: ReactNode | (() => ReactNode);
  icon?: "info" | "calendar" | "table";
  size?: "regular" | "wide";
  compactLabel?: boolean;
}) {
  const { locale, l } = useLabI18n();
  const displayedTitle = locale === "en" && titleEn ? titleEn : l(title);
  const displayedLabel = locale === "en" && labelEn ? labelEn : l(label);
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const Icon =
    icon === "calendar" ? CalendarDays : icon === "table" ? Table2 : Info;

  useEffect(() => {
    if (!open) return;
    return acquireBodyScrollLock(document.body);
  }, [open]);

  return (
    <>
      <button
        aria-label={displayedLabel}
        title={displayedLabel}
        className="inline-flex min-h-9 items-center gap-2 rounded px-2 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--wash)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
        onClick={() => {
          ref.current?.showModal();
          setOpen(true);
        }}
        type="button"
      >
        <Icon aria-hidden="true" size={15} strokeWidth={1.6} />
        <span className={compactLabel ? "hidden sm:inline" : undefined}>{displayedLabel}</span>
      </button>
      <dialog
        aria-labelledby={id}
        className={`varda-dialog fixed inset-0 m-auto max-h-[min(88dvh,850px)] w-[calc(100%_-_24px)] overflow-hidden p-0 ${size === "wide" ? "max-w-[1180px]" : "max-w-[760px]"}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) ref.current?.close();
        }}
        onCancel={(event) => {
          // The browser cancels only the top modal; keep that event local.
          event.stopPropagation();
        }}
        onClose={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) setOpen(false);
        }}
        ref={ref}
      >
        <div className="flex max-h-[min(88dvh,850px)] flex-col">
          <header className="varda-dialog-header flex shrink-0 items-center justify-between gap-4">
            <h2 className="text-base font-medium" id={id}>
              {displayedTitle}
            </h2>
            <LocalizedElement as="button"
              aria-label="닫기"
              className="varda-icon-button"
              onClick={() => ref.current?.close()}
              title="닫기"
              type="button" en={{"aria-label": labEnglish("닫기"), "title": labEnglish("닫기")}}
            >
              <X aria-hidden="true" size={18} />
            </LocalizedElement>
          </header>
          <div className="varda-dialog-content min-h-0 overflow-y-auto overscroll-contain">
            {open ? typeof children === "function" ? children() : children : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
