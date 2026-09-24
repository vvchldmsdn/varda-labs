"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";
import styles from "./quick-trade-actions.module.css";

const Ledger = dynamic(() => import("./native-ledger-view").then(module => module.NativeLedgerView));
export function QuickTradeActions({ accountId, assetId, name, quantity = "0" }: { accountId?: string; assetId?: string; name?: string; quantity?: string }) {
  const { t } = useI18n();
  const router = useRouter(), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
  const title = useId();
  const [action, setAction] = useState<"buy" | "sell" | null>(null);
  const [saved, setSaved] = useState(false);
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (opened) return acquireBodyScrollLock(document.body); }, [opened]);
  function open(next: "buy" | "sell", element: HTMLElement) { trigger.current = element; setSaved(false); if (!pending) { setAction(next); setAttempt(value => value + 1); } setOpened(true); dialog.current?.showModal(); }
  function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(node => node.getClientRects().length > 0);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className={styles.actions}>
    <button type="button" onClick={event => open("buy", event.currentTarget)} aria-label={assetId ? `${name} ${t("매수", "Buy")}` : undefined}>{assetId ? t("매수", "Buy") : t("+ 새 종목 매수", "+ Buy a new holding")}</button>
    {assetId ? <button type="button" disabled={Number(quantity) <= 0} onClick={event => open("sell", event.currentTarget)} aria-label={`${name} ${t("매도", "Sell")}`}>{t("매도", "Sell")}</button> : null}
    {saved ? <span role="status">{t("기록했어요", "Recorded")}</span> : null}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} onKeyDown={containFocus} onCancel={event => { if (busy) event.preventDefault(); }} onClick={event => { if (!busy && event.target === event.currentTarget) dialog.current?.close(); }} onClose={() => { setOpened(false); if (!pending) setAction(null); trigger.current?.focus(); }}>
      <div className={styles.shell}>
        <header><div><h2 id={title}>{name ?? t("새 종목", "New holding")} · {action === "sell" ? t("매도", "Sell") : t("매수", "Buy")}</h2></div><button type="button" disabled={busy} onClick={() => dialog.current?.close()} aria-label={t("닫기", "Close")}><X size={20} /></button></header>
        {action ? <Suspense fallback={<p role="status">{t("거래 입력을 준비하고 있어요…", "Loading trade form…")}</p>}><Ledger key={attempt} compact onBusyChange={setBusy} onPendingChange={setPending} newInstrument={!assetId} initialSelection={{ accountId, assetId, action }} onSaved={() => { setPending(false); setBusy(false); setSaved(true); router.refresh(); dialog.current?.close(); setAction(null); }} /></Suspense> : null}
      </div>
    </dialog>
  </div>;
}
