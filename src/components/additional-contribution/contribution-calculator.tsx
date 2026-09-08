"use client";

import { PortfolioText, usePortfolioText } from "@/components/portfolio/portfolio-text";


import { useState, useTransition, type FormEvent, type ReactNode, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import styles from "./contribution-stage.module.css";

const PRESETS = [1_000_000, 3_000_000, 5_000_000, 10_000_000];

export function ContributionCalculator({ amountKrw, scopeKey, isDesignPreview, status, children, allocations }: {
  amountKrw: number;
  scopeKey: string;
  isDesignPreview: boolean;
  status: "ready" | "blocked";
  children: ReactNode;
  allocations?: ReactNode;
}) {
  const pt = usePortfolioText();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    query.set("scope", scopeKey);
    query.set("amount", String(data.get("amount") ?? ""));
    if (isDesignPreview) query.set("preview", "design");
    setSubmitted(true);
    startTransition(() => router.push(`/additional-contribution?${query}`, { scroll: false }));
  }

  return (
    <section className={styles.workspace} data-calculating={isPending} aria-label={pt("추가 투입 계산")}>
      <form action="/additional-contribution" method="get" onSubmit={submit} className={styles.form}>
        <input type="hidden" name="scope" value={scopeKey} />
        {isDesignPreview ? <input type="hidden" name="preview" value="design" /> : null}
        <label htmlFor="additional-contribution-amount"><PortfolioText ko={"얼마를 더 투자할까요?"} /></label>
        <div className={styles.amountInput}>
          <input key={amountKrw} id="additional-contribution-amount" aria-describedby="additional-contribution-amount-hint" defaultValue={amountKrw ? amountKrw.toLocaleString("ko-KR") : ""} inputMode="numeric" name="amount" pattern="[0-9,]*" placeholder="0" required type="text" disabled={isPending} />
          <span><PortfolioText ko={"원"} /></span>
        </div>
        <div aria-label={pt("투입 금액 빠른 선택")} className={styles.presets}>
          {PRESETS.map((preset) => <button type="button" key={preset} disabled={isPending} onClick={(event) => {
            const form = event.currentTarget.form;
            const input = form?.elements.namedItem("amount");
            if (input instanceof HTMLInputElement) { input.value = preset.toLocaleString("ko-KR"); input.focus(); }
          }}><PortfolioText ko={`${preset / 10_000}만`} en={new Intl.NumberFormat("en-US", { style: "currency", currency: "KRW", notation: "compact", maximumFractionDigits: 1 }).format(preset)} /></button>)}
        </div>
        <div className={styles.submitRow}>
          <button type="submit" className={styles.calculate} disabled={isPending}><PortfolioText ko={isPending ? "계산 중" : "배분안 계산"} />{isPending ? <LoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}</button>
          <span className={styles.calculationStatus} role="status">{isPending ? pt("현재 가격과 목표를 계산하고 있어요") : submitted ? <>{status === "ready" ? <Check size={13} aria-hidden="true" /> : null}<PortfolioText ko={status === "ready" ? "계산 완료" : "계산 근거 확인 필요"} /></> : ""}</span>
        </div>
        <p id="additional-contribution-amount-hint" className={styles.hint}><PortfolioText ko={"계산 결과만 제공하며 실제 주문은 실행하지 않습니다."} /></p>
      </form>
      <div className={styles.fundingPanel} aria-busy={isPending}>{children}</div>
      {allocations ? <aside className={styles.featuredPanel} aria-label={pt("대표 배분 결과")}>{allocations}</aside> : null}
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
        {segments.map((row, index) => <button key={row.key} type="button" className={styles.fundingSegment} aria-label={pt(`${row.name}, ${formatKrw(row.amount)}, 재원의 ${total > 0 ? (row.amount / total * 100).toFixed(1) : "0"}%`)} aria-pressed={active?.key === row.key} onPointerEnter={() => setSelected(row.key)} onFocus={() => setSelected(row.key)} onClick={() => setSelected(row.key)} style={{ width: `${total > 0 ? row.amount / total * 100 : 0}%`, background: FUND_COLORS[index % FUND_COLORS.length], "--bar-delay": `${index * 35}ms` } as CSSProperties} />)}
      </div>
      <div className={styles.fundingSelection} aria-live="polite"><span>{active?.name ?? <PortfolioText ko="배분 가능한 종목 없음" />}</span><strong>{active ? formatKrw(active.amount) : "—"}</strong><ArrowRight size={14} aria-hidden="true" /></div>
      <div className={styles.fundingLegend} aria-label={pt("배분 종목 선택")}>{segments.map((row, index) => <button key={row.key} type="button" aria-pressed={active?.key === row.key} onClick={() => setSelected(row.key)}><i style={{ background: FUND_COLORS[index % FUND_COLORS.length] }} />{row.name}</button>)}</div>
    </div>
  );
}

function formatKrw(value: number) { return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value); }
