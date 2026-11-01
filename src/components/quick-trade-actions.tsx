"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Suspense, createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";
import motion from "@/components/onboarding/entry-motion.module.css";
import styles from "./quick-trade-actions.module.css";
import { Button as CairnButton, IconButton, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";


const Ledger = dynamic(() => import("./native-ledger-view").then(module => module.NativeLedgerView));
type TradeSelection = { accountId?: string; assetId?: string; name?: string; quantity?: string };
type TradeRequest = TradeSelection & { side: "buy" | "sell"; trigger: HTMLElement; id: string };
const TradeContext = createContext<((request: TradeRequest) => void) | null>(null);
/** Kept above the legacy/native home branch so a refreshed portfolio cannot unmount an open record. */
export function QuickTradeWorkspace({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<TradeRequest | null>(null);
  const [pending, setPending] = useState(false);
  return <TradeContext.Provider value={next => setRequest(current => pending && current ? { ...current, id: next.id, trigger: next.trigger } : next)}>{children}<QuickTradeDialog request={request} onGuardChange={setPending} /></TradeContext.Provider>;
}
export function QuickTradeActions(props: TradeSelection) {
  const open = useContext(TradeContext), { t } = useI18n();
  if (!open) return <QuickTradeWorkspace><QuickTradeActions {...props} /></QuickTradeWorkspace>;
  const { assetId, name, quantity = "0" } = props;
  return <div className={styles.actions}>
    <CairnButton variant="secondary" type="button" onClick={event => open({ ...props, side: "buy", trigger: event.currentTarget, id: crypto.randomUUID() })} aria-label={assetId ? name + " " + t("매수", "Buy") : undefined}>{assetId ? t("매수", "Buy") : t("+ 새 종목 매수", "+ Buy a new holding")}</CairnButton>
    {assetId && <CairnButton variant="secondary" type="button" disabled={Number(quantity) <= 0} onClick={event => open({ ...props, side: "sell", trigger: event.currentTarget, id: crypto.randomUUID() })} aria-label={name + " " + t("매도", "Sell")}>{t("매도", "Sell")}</CairnButton>}
  </div>;
}
function QuickTradeDialog({ request, onGuardChange }: { request: TradeRequest | null; onGuardChange: (pending: boolean) => void }) {
  const { accountId, assetId, name } = request ?? {};
  const { t } = useI18n();
  const router = useRouter(), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
  const title = useId();
  const [action, setAction] = useState<"buy" | "sell" | null>(null);
  const [saved, setSaved] = useState(false);
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (opened) return acquireBodyScrollLock(document.body); }, [opened]);
  useEffect(() => {
    if (!request) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      trigger.current = request.trigger; setSaved(false); if (!pending) { setAction(request.side); setAttempt(value => value + 1); } setOpened(true); dialog.current?.showModal();
    });
    return () => { active = false; };
    // A pending operation retains its mounted recovery form when reopened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(node => node.getClientRects().length > 0);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className={styles.actions}>
    {saved ? <CairnStatus as="span" tone="neutral" className={motion.success} role="status"><Check size={16} aria-hidden="true" />{t("기록했어요", "Recorded")}</CairnStatus> : null}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} onKeyDown={containFocus} onCancel={event => { if (busy) event.preventDefault(); }} onClick={event => { if (!busy && event.target === event.currentTarget) dialog.current?.close(); }} onClose={() => { setOpened(false); if (!pending) setAction(null); if (trigger.current?.isConnected) trigger.current.focus(); else document.querySelector<HTMLElement>("main button:not(:disabled),main a[href]")?.focus(); }}>
      <div className={styles.shell}>
        <header><div><CairnSectionTitle id={title}>{name ?? t("새 종목", "New holding")} · {t("거래 기록", "Trade record")}</CairnSectionTitle></div><IconButton disabled={busy} onClick={() => dialog.current?.close()} label={t("닫기", "Close")} title={t("닫기", "Close")}><X size={20} /></IconButton></header>
        {action ? <Suspense fallback={<CairnStatus as="p" tone="neutral" role="status">{t("거래 입력을 준비하고 있어요…", "Loading trade form…")}</CairnStatus>}><Ledger key={attempt} compact onBusyChange={setBusy} onPendingChange={value => { setPending(value); onGuardChange(value); }} newInstrument={!assetId} initialSelection={{ accountId, assetId, action }} onSaved={() => { setPending(false); onGuardChange(false); setBusy(false); setSaved(true); router.refresh(); dialog.current?.close(); setAction(null); }} /></Suspense> : null}
      </div>
    </dialog>
  </div>;
}
