"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, X } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";
import { formatDate } from "./portfolio-format";
import styles from "./holding-date-picker.module.css";

export function HoldingDatePicker({ dates, value, onChange }: {
  dates: readonly string[];
  value: string | undefined;
  onChange: (date: string) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const release = acquireBodyScrollLock(document.body);
    dialogRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
    return release;
  }, [open]);
  const close = () => dialogRef.current?.close();
  return <>
    <button className={styles.trigger} type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-label={t(`조회 날짜 선택: ${value ? formatDate(value) : "미선택"}`, `Choose a date: ${value ? formatDate(value) : "No date"}`)}
      onClick={() => { dialogRef.current?.showModal(); setOpen(true); }}>
      <CalendarDays size={15} aria-hidden="true" />{value ? formatDate(value) : "—"}<ChevronDown size={14} aria-hidden="true" />
    </button>
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId}
      onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.shell}>
        <header><div><h3 id={titleId}>{t("조회 날짜", "Choose a date")}</h3><p>{t("확인할 하루를 선택하세요.", "Choose the day you want to explore.")}</p></div>
          <button type="button" aria-label={t("날짜 선택 취소", "Cancel date selection")} onClick={close}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className={styles.dates}>
          {open ? [...dates].reverse().map(date => <button type="button" key={date} aria-pressed={date === value}
            onClick={() => { onChange(date); close(); }}><span>{formatDate(date)}</span>{date === value ? <Check size={17} aria-hidden="true" /> : null}</button>) : null}
        </div>
        <footer><button type="button" onClick={close}>{t("취소", "Cancel")}</button></footer>
      </div>
    </dialog>
  </>;
}
