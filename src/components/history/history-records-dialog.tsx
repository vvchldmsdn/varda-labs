"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";
import { historyDetailHref, type HistoryDetailPanel } from "./history-detail-state";

/** Children are built by the authenticated server page only for the requested panel. */
export function HistoryRecordsDialog({ panel, children }: { panel: HistoryDetailPanel; children?: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const releaseScrollRef = useRef<(() => void) | null>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (panel && dialog && !dialog.open) dialog.showModal();
    if (!panel && dialog?.open) dialog.close();
    if (!panel) return;
    const release = acquireBodyScrollLock(document.body);
    releaseScrollRef.current = release;
    return () => {
      release();
      if (releaseScrollRef.current === release) releaseScrollRef.current = null;
    };
  }, [panel]);

  function navigate(changes: Record<string, string | null>) {
    startTransition(() => router.replace(historyDetailHref(params.toString(), changes), { scroll: false }));
  }

  function close() { dialogRef.current?.close(); }

  function keepFocusInside(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return <>
    <button className="varda-presentation-detail-trigger" type="button" ref={triggerRef} aria-disabled={pending} aria-busy={pending} onClick={() => { if (!pending) navigate({ detail: "records" }); }}>
      <span>{pending ? "기록 불러오는 중…" : "기록·이벤트"}</span><Maximize2 aria-hidden="true" size={15} strokeWidth={1.6} />
    </button>
    <dialog ref={dialogRef} aria-labelledby={titleId} className="varda-dialog varda-presentation-dialog varda-presentation-dialog-wide"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      onKeyDown={keepFocusInside}
      onClose={(event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        releaseScrollRef.current?.();
        releaseScrollRef.current = null;
        triggerRef.current?.focus();
        if (panel) navigate({ detail: null, balancePage: null, portfolioPage: null, eventPage: null, positionDate: null, positionSource: null, comparisonFrom: null, comparisonTo: null });
      }}>
      {panel ? <div className="varda-presentation-dialog-shell">
        <header className="varda-dialog-header flex shrink-0 items-start justify-between gap-5">
          <div><p className="varda-kicker">DETAIL VIEW</p><h2 className="mt-2 text-xl font-medium" id={titleId}>{panel === "raw" ? "히스토리 원시 기록" : "기록에서 발견한 변화"}</h2></div>
          <button aria-label="닫기" autoFocus className="varda-icon-button" type="button" onClick={close}><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="varda-dialog-content varda-presentation-dialog-content">{children}</div>
      </div> : null}
    </dialog>
  </>;
}

export function HistoryDetailLink({ children, changes }: { children: ReactNode; changes: Record<string, string | null> }) {
  const params = useSearchParams();
  return <Link href={historyDetailHref(params.toString(), changes)} prefetch={false} scroll={false} className="varda-presentation-detail-trigger">{children}</Link>;
}

export function HistoryEvidenceLink({ href, children, ...props }: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) {
  const current = useSearchParams();
  const target = new URLSearchParams(href.split("?")[1]);
  target.set("detail", "raw");
  for (const key of ["balancePage", "portfolioPage", "eventPage", "preview"]) {
    const value = current.get(key);
    if (value !== null) target.set(key, value);
  }
  return <Link {...props} href={`/history?${target}`} prefetch={false} scroll={false}>{children}</Link>;
}

export function HistoryEvidenceForm({ children, className }: { children: ReactNode; className?: string }) {
  const router = useRouter();
  const current = useSearchParams();
  const [pending, startTransition] = useTransition();
  return <form action="/history" method="get" className={className} aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    const changes: Record<string, string | null> = { detail: "raw", positionDate: null, positionSource: null };
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string") changes[key] = value;
    }
    startTransition(() => router.replace(historyDetailHref(current.toString(), changes), { scroll: false }));
  }}>
    <input type="hidden" name="detail" value="raw" />
    {children}
  </form>;
}
