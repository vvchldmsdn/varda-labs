"use client";

import { PortfolioText, usePortfolioText } from "@/components/portfolio/portfolio-text";


import { useState, useTransition, type FormEvent, type ReactNode, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import { buildPortfolioTargetNavigation } from "@/lib/portfolio-target-navigation";
import { recoveryHref } from '@/lib/recovery-navigation';
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import type { PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";
import {SaleExclusionPicker,type SaleExclusionOption} from "../sale-exclusion-picker";
import {SaleSelectionResultGate,useSaleSelection} from "../sale-exclusion-state";
import styles from "./contribution-stage.module.css";
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, InfoDisclosure, Status as CairnStatus } from "@/components/cairn-ui";


const PRESETS = [1_000_000, 3_000_000, 5_000_000, 10_000_000];
const CONTRIBUTION_FORM_ID = "additional-contribution-form";
export type ContributionTargetActionKind = "set" | "review";

/** Outside the form (including a reason dialog), use its current amount too. */
export function ContributionTargetAction({ action }: { action: ContributionTargetActionKind }) {
  return <CairnButton variant="primary" type="submit" form={CONTRIBUTION_FORM_ID} formNoValidate className={styles.textLink}><PortfolioText ko={action === "set" ? "목표비중 설정" : "목표비중 다시 확인"} en={action === "set" ? "Set target weights" : "Review target weights"} /><ArrowUpRight size={16} aria-hidden="true" /></CairnButton>;
}

export function ContributionCalculator({ amountKrw, scopeKey, isDesignPreview, status, targetAction, children, allocations, exclusionOptions=[], blockers=[] }: {
  blockers?: readonly string[];
  exclusionOptions?: readonly SaleExclusionOption[];
  amountKrw: number;
  scopeKey: PortfolioAnalysisScopeKey;
  isDesignPreview: boolean;
  status: "ready" | "blocked";
  targetAction?: ContributionTargetActionKind;
  children: ReactNode;
  allocations?: ReactNode;
}) {
  const saleSelection=useSaleSelection();
  const pt = usePortfolioText();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [draft, setDraft] = useState({basis:amountKrw,value:amountKrw ? amountKrw.toLocaleString('ko-KR') : ''});
  const amount = draft.basis === amountKrw ? draft.value : amountKrw.toLocaleString('ko-KR');
  const returnQuery = new URLSearchParams({scope:scopeKey,amount:amount.replaceAll(',',''),...(isDesignPreview ? {preview:'design'} : {})});
  for (const key of saleSelection?.keys ?? []) returnQuery.append('excludeSell',key);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    const data = new FormData(event.currentTarget);
    if (targetAction) {
      const navigation = buildPortfolioTargetNavigation({ scopeKey, from: "contribution", isDesignPreview,
        amount: String(data.get("amount") ?? "").replaceAll(",", "").trim() });
      startTransition(() => router.push(recoveryHref(navigation.settingsHref, '/additional-contribution?'+returnQuery) ?? navigation.settingsHref));
      return;
    }
    const query = new URLSearchParams();
    query.set("scope", scopeKey);
    query.set("amount", String(data.get("amount") ?? ""));
    for(const key of saleSelection?.keys??[])query.append("excludeSell",key);
    if (isDesignPreview) query.set("preview", "design");
    setSubmitted(true);
    startTransition(() => router.push(`/additional-contribution?${query}`, { scroll: false }));
  }

  return (
    <section className={styles.workspace} data-calculating={isPending} aria-label={pt("추가 투입 계산")}>
      <CairnForm id={CONTRIBUTION_FORM_ID} action={targetAction ? "/portfolio/targets" : "/additional-contribution"} method="get" onSubmit={submit} className={styles.form}>
        <input type="hidden" name="scope" value={scopeKey} />
        {targetAction ? <input type="hidden" name="from" value="contribution" /> : null}
        {isDesignPreview ? <input type="hidden" name="preview" value="design" /> : null}
        <CairnField htmlFor="additional-contribution-amount"><PortfolioText ko={"얼마를 더 투자할까요?"} /></CairnField>
        <div className={styles.amountInput}>
          <CairnInput presentation="amount" id="additional-contribution-amount" aria-describedby="additional-contribution-amount-hint" value={amount} onChange={event=>setDraft({basis:amountKrw,value:event.target.value})} inputMode="numeric" name="amount" pattern="[0-9,]*" placeholder="0" required type="text" disabled={isPending} />
          <span><PortfolioText ko={"원"} /></span>
        </div>
        <div aria-label={pt("투입 금액 빠른 선택")} className={styles.presets}>
          {PRESETS.map((preset) => <CairnButton variant="secondary" type="button" key={preset} disabled={isPending} onClick={(event) => {
            const form = event.currentTarget.form;
            const input = form?.elements.namedItem("amount");
            if (input instanceof HTMLInputElement) { setDraft({basis:amountKrw,value:preset.toLocaleString('ko-KR')}); input.focus(); }
          }}><PortfolioText ko={`${preset / 10_000}만`} en={new Intl.NumberFormat("en-US", { style: "currency", currency: "KRW", notation: "compact", maximumFractionDigits: 1 }).format(preset)} /></CairnButton>)}
        </div>
        {!isDesignPreview&&<SaleExclusionPicker options={exclusionOptions} value={saleSelection?.keys??[]} onChange={keys=>saleSelection?.choose(keys)} disabled={isPending}/>}
        <div className={styles.submitRow}>
          <CairnButton variant="primary" type="submit" formNoValidate={Boolean(targetAction)} className={styles.calculate} disabled={isPending}>{targetAction ? <PortfolioText ko={isPending ? "목표비중으로 이동 중" : targetAction === "set" ? "목표비중 설정" : "목표비중 다시 확인"} en={isPending ? "Opening target weights" : targetAction === "set" ? "Set target weights" : "Review target weights"} /> : <PortfolioText ko={isPending ? "계산 중" : "배분안 계산"} />}{isPending ? <LoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}</CairnButton>
          <CairnStatus as="span" tone="neutral" className={styles.calculationStatus} role="status">{isPending ? targetAction ? pt("입력한 금액을 유지하고 이동합니다", "Keeping your entered amount") : pt("현재 가격과 목표를 계산하고 있어요") : submitted ? <>{status === "ready" ? <Check size={13} aria-hidden="true" /> : null}<PortfolioText ko={status === "ready" ? "계산 완료" : "계산 근거 확인 필요"} /></> : ""}</CairnStatus>
        </div>
        <InfoDisclosure summary={pt("계산 기준", "Calculation basis")}>
          <p id="additional-contribution-amount-hint"><PortfolioText ko={"계산 결과만 제공하며 실제 주문은 실행하지 않습니다."} /></p>
        </InfoDisclosure>
        {status === 'blocked' && !targetAction && <RecoveryNotice reasons={blockers} scope={scopeKey} allowResolve={!isDesignPreview} returnHref={'/additional-contribution?'+returnQuery} />}
      </CairnForm>
      <div className={styles.fundingPanel} aria-busy={isPending}><SaleSelectionResultGate>{children}</SaleSelectionResultGate></div>
      {allocations ? <aside className={styles.featuredPanel} aria-label={pt("대표 배분 결과")}><SaleSelectionResultGate>{allocations}</SaleSelectionResultGate></aside> : null}
      <span className={styles.pendingLine} aria-hidden="true" />
    </section>
  );
}

type FundingRow = { key: string; name: string; amount: number };
const FUND_COLORS = ["#ef5a32", "#30362f", "#cda680", "#8b9d89", "#80909b", "#bdbbae"];

export function ContributionFundingVisual({ cash, trims, total, residual, rows }: {
  cash: number;
  trims: number;
  total: number;
  residual: number;
  rows: readonly FundingRow[];
}) {
  const pt = usePortfolioText();
  const [selected, setSelected] = useState<string | null>(null);
  const positive = rows.filter(row => row.amount > 0).toSorted((a, b) => b.amount - a.amount);
  const visible = positive.slice(0, 4);
  const others = positive.slice(4);
  const segments: FundingRow[] = [
    ...visible,
    ...(others.length ? [{ key: "other", name: pt(`그 외 ${others.length}종목`), amount: others.reduce((sum, row) => sum + row.amount, 0) }] : []),
    ...(residual > 0 ? [{ key: "cash", name: pt("남는 현금"), amount: residual }] : []),
  ];
  const active = segments.find(row => row.key === selected) ?? segments[0];
  const signature = segments.map(row => `${row.key}:${row.amount}`).join("|");
  return (
    <div className={styles.fundingVisual}>
      <div className={styles.fundingSources}><span><PortfolioText ko={"신규"} />{" "}{formatKrw(cash)}</span><i aria-hidden="true">+</i><span><PortfolioText ko={"계산상 매도"} />{" "}{formatKrw(trims)}</span></div>
      <div className={styles.fundingTotal}><span><PortfolioText ko={"매수 가능 재원"} /></span><strong>{formatKrw(total)}</strong></div>
      <div key={signature} className={styles.fundingBar} role="group" aria-label={pt("매수 가능 재원의 배분")}>
        {segments.map((row, index) => <CairnButton variant="bare" key={row.key} type="button" className={styles.fundingSegment} aria-label={pt(`${row.name}, ${formatKrw(row.amount)}, 재원의 ${total > 0 ? (row.amount / total * 100).toFixed(1) : "0"}%`)} aria-pressed={active?.key === row.key} onPointerEnter={() => setSelected(row.key)} onFocus={() => setSelected(row.key)} onClick={() => setSelected(row.key)} style={{ width: `${total > 0 ? row.amount / total * 100 : 0}%`, background: FUND_COLORS[index % FUND_COLORS.length], "--bar-delay": `${index * 35}ms` } as CSSProperties} />)}
      </div>
      <div className={styles.fundingSelection} aria-live="polite"><span>{active?.name ?? <PortfolioText ko="배분 가능한 종목 없음" />}</span><strong>{active ? formatKrw(active.amount) : "—"}</strong><ArrowRight size={14} aria-hidden="true" /></div>
      <div className={styles.fundingLegend} aria-label={pt("배분 종목 선택")}>{segments.map((row, index) => <CairnButton variant="bare" key={row.key} type="button" aria-pressed={active?.key === row.key} onClick={() => setSelected(row.key)}><i style={{ background: FUND_COLORS[index % FUND_COLORS.length] }} />{row.name}</CairnButton>)}</div>
    </div>
  );
}

function formatKrw(value: number) { return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value); }
