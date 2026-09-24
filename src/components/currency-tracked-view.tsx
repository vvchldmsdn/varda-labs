"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { PortfolioAllocationRing } from "@/components/portfolio/portfolio-allocation-ring";
import { MoneyInput } from "@/components/first-visit/money-input";
import { intlLocale } from "@/lib/i18n/locale";
import { Decimal, formatMoney, parseMoneyInput, type Currency } from "@/lib/money";
import { buildTrackedCurrencyPortfolio, type CurrencyTrackedInput } from "@/lib/currency-tracked-portfolio";
import { calculateCurrencyContribution } from "@/lib/currency-contribution";
import { NativeContributionPlanner } from "@/components/native-contribution-planner";
import styles from "./currency-tracked-view.module.css";

type ContributionPolicy = { trimDriftThresholdPct: number; minimumExecutionRatioPct: number };
type Contribution = ReturnType<typeof calculateCurrencyContribution>;
const ZONES = ["Asia/Seoul", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Tokyo", "UTC"];

export function CurrencyTrackedView({ evidence, timeZone = "Asia/Seoul", contributionPolicy, surface, hideCurrencyControl = false, nativeContributionScopeKey }: {
  evidence: CurrencyTrackedInput; timeZone?: string; contributionPolicy?: ContributionPolicy;
  surface?: "home" | "today" | "history" | "structure" | "contribution";
  hideCurrencyControl?: boolean;
  nativeContributionScopeKey?: string;
}) {
  const { locale, t } = useI18n();
  const [currency, setCurrency] = useState<Currency>(evidence.reporting);
  const [zone, setZone] = useState(timeZone);
  const [selected, setSelected] = useState("");
  const report = useMemo(() => buildTrackedCurrencyPortfolio({ ...evidence, reporting: currency }), [currency, evidence]);
  const [cash, setCash] = useState("");
  const [cashCurrency, setCashCurrency] = useState<Currency>(evidence.reporting);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [calculation, setCalculation] = useState<{ evidence: CurrencyTrackedInput; result: Contribution } | null>(null);
  const [error, setError] = useState("");
  const [useAvailableCash, setUseAvailableCash] = useState(false);
  const securityPositions = evidence.current.positions.filter(row => row.kind !== "cash");
  const cashPositions = evidence.current.positions.filter(row => row.kind === "cash");
  const money = (value: string | number | null, inCurrency = currency) => value === null ? "—" : formatMoney(Number(value), inCurrency, intlLocale(locale));
  const date = (value: string) => {
    if (!Number.isFinite(Date.parse(value))) return "—";
    const format = (timeZone: string) => {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
      const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
      return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
    };
    try { return format(zone); } catch { return format("UTC"); }
  };
  const unavailable = (reason: string | null) => {
    if (reason === "corporate_actions_pending" || reason === "corporate_actions_provisional") return t("기업행위 확인 중 · 평가 대기", "Corporate actions pending · valuation on hold");
    if (reason === "corporate_action_price_pending") return t("기업행위 이후 시세 확인 중", "Waiting for a post-action quote");
    if (reason === "corporate_actions_conflict" || reason === "corporate_action_ledger_mismatch") return t("기업행위와 보유 수량 확인 필요", "Corporate actions and recorded shares need reconciliation");
    if (reason === "group_income_allocation_missing") return t("배당·비용의 해당 종목을 확인하면 그룹 성과를 계산할 수 있어요.", "Assign the income or cost to a holding to calculate this group's return.");
    if (reason?.includes("fx")) return t("해당 시점의 환율 확인 필요", "An exchange rate for this time is needed");
    if (reason === "price_stale") return t("시세가 오래되어 평가에서 제외", "Quote is too old to value this holding");
    if (reason === "trade_evidence_missing" || reason?.includes("ledger") || reason?.includes("quantity")) return t("거래 이력이 부족해 가격과 환율 영향을 분리할 수 없어요.", "Trade history is incomplete, so price and currency effects cannot be separated.");
    if (reason === "manual_gold" || reason === "fractional_value_not_dated") return t("원본 가격과 평가 시점 확인 필요", "Native price and valuation time are needed");
    return t("계산에 필요한 근거가 부족해요.", "More evidence is needed for this calculation.");
  };
  const invalidate = () => { setCalculation(null); setError(""); };
  function calculate(event: FormEvent) {
    event.preventDefault();
    invalidate();
    if (!report.current?.complete || !contributionPolicy) return;
    const amount = cash.trim() === "" && useAvailableCash ? 0 : parseMoneyInput(cash, cashCurrency);
    const availableNative = useAvailableCash ? cashPositions.filter(row => row.observation && Decimal.from(row.observation.quantity).compare(0) > 0) : [];
    if (amount === null || amount < 0 || (amount === 0 && availableNative.length === 0)) { setError(t("통화에 맞는 0보다 큰 투자금을 입력하세요.", "Enter an amount greater than zero using this currency’s precision.")); return; }
    const bps = securityPositions.map(row => {
      const value = targets[row.id]?.trim();
      if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
      try { const result = Decimal.from(value).mul(100); return result.d === BigInt(1) && result.compare(10000) <= 0 ? Number(result.n) : null; } catch { return null; }
    });
    if (bps.some(value => value === null) || bps.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== 10000) {
      setError(t("각 목표 비중을 입력하고 합계를 100%로 맞춰 주세요.", "Enter every target weight so they add up to 100%.")); return;
    }
    const asOf = evidence.current.at;
    try {
      const result = calculateCurrencyContribution({ reportingCurrency: currency, asOf, fx: evidence.fx, maxFxAgeMs: evidence.maxFxAgeMs,
        ...contributionPolicy, funds: [...(amount > 0 ? [{ amount: String(amount), currency: cashCurrency, at: asOf, source: "manual" }] : []), ...availableNative.map(row => ({ amount: row.observation!.quantity, currency: row.observation!.currency, at: asOf, source: row.observation!.source }))],
        rows: securityPositions.map((row, index) => ({ allocationKey: row.id, assetType: null, buyable: true,
          targetWeightBps: bps[index]!, metadata: null, maRuleEnabled: true, maAssetClass: null,
          ma120Evidence: { status: "unavailable", distanceFromMaPct: null },
          value: { amount: Decimal.from(row.observation!.quantity).mul(row.observation!.price).toExactString(), currency: row.observation!.currency, at: asOf, source: row.observation!.source },
          cost: row.cost ?? null,
          ...(row.costLots !== undefined ? { costLots: row.costLots } : {}),
        })),
      });
      setCalculation({ evidence, result });
    } catch { setError(t("입력과 평가 근거를 다시 확인해 주세요.", "Please check the inputs and valuation evidence.")); }
  }

  if (!report.current) return <main className={styles.page}><h1>{t("자산 평가를 확인할 수 없어요.", "Portfolio valuation is unavailable.")}</h1><p>{t("다시 로그인한 뒤 확인해 주세요.", "Please sign in again and retry.")}</p></main>;
  const current = report.current;
  const showHoldings = !surface || ["home", "today", "structure"].includes(surface);
  const showMovement = !surface || ["home", "today"].includes(surface);
  const showHistory = !surface || surface === "history";
  const showContribution = !surface || surface === "contribution";
  const titles = { home: ["내 자산의 흐름", "My portfolio"], today: ["오늘의 변화를 살펴보세요.", "What moved today?"], history: ["자산이 지나온 시간", "Your portfolio over time"], structure: ["내 포트폴리오의 구성", "Inside your portfolio"], contribution: ["다음 투자금, 목표에 가깝게.", "Bring your next contribution closer to your targets."] };
  const title = surface ? titles[surface] : ["통화가 바뀌면, 평가도 달라집니다.", "One portfolio. Two perspectives."];
  const active = current.positions.find(row => row.id === selected) ?? current.positions[0];
  const native = evidence.current.positions.find(row => row.id === active?.id)?.observation;
  const entries = current.positions.filter((row): row is typeof row & { weightPct: number } => row.weightPct !== null).map(row => ({ key: row.id, name: row.name, weightPct: row.weightPct }));
  const currentCalculation = calculation?.evidence === evidence ? calculation.result : null;
  const ready = currentCalculation?.status === "ready" ? currentCalculation : null;
  const resultMoney = (value: number) => money(value, ready?.context.reportingCurrency ?? currency);
  return <main className={styles.page} id="varda-main-content">
    <header className={styles.heading}><div><p className={styles.eyebrow}>{t("보유자산 평가", "HOLDINGS VALUATION")} · {currency}</p><h1>{t(title[0], title[1])}</h1></div>
      {!hideCurrencyControl ? <label className={styles.selectLabel}>{t("분석 통화", "Analysis currency")}<select value={currency} onChange={event => { setCurrency(event.target.value as Currency); invalidate(); }}><option value="KRW">KRW · ₩</option><option value="USD">USD · $</option></select></label> : null}
    </header>
    {evidence.current.source === "synthetic_fixture" ? <p className={styles.notice}>{t("체험 모드 · 가상 데이터", "Preview · synthetic data")}</p> : null}
    {evidence.groupEvidence ? <details className={styles.method}><summary>{t("그룹 계산 범위", "Group calculation scope")}</summary><p>{t("선택한 계좌는 현금을 포함하고, 개별 종목은 그 종목만 포함해요.", "Selected accounts include their cash; individually selected holdings include only the holding.")}</p><p>{t("현재 구성으로 비교 가능한 시작", "Current membership window starts")} · {date(evidence.groupEvidence.stableSince)}</p></details> : null}
    <div className={styles.context}><span>{t("평가 시각", "Valued at")} · {date(current.at)}</span><details><summary>{t("시간대", "Time zone")} · {zone}</summary><select aria-label={t("표시 시간대", "Display time zone")} value={zone} onChange={event => setZone(event.target.value)}>{[...new Set([...ZONES, timeZone])].map(value => <option key={value}>{value}</option>)}</select><p>{t("표시 시각만 바뀝니다. 서비스 일자는 한국시간 오전 7시를 기준으로 구분해요.", "This changes display times. Service days still roll over at 7 am in Korea.")}</p></details></div>

    <section className={styles.valuation} aria-label={t("현재 평가", "Current valuation")}>
      <div className={styles.total}><p>{current.complete ? t("조회 범위의 평가액", "Value of included holdings") : t("확인 가능한 자산의 소계", "Subtotal with evidence")}</p><strong>{money(current.coverage.valued > 0 ? current.total ?? current.verifiedSubtotal : null)}</strong>
        {!current.complete ? <p className={styles.notice} role="status">{t(`전체 평가액과 비중은 계산할 수 없어요. ${current.coverage.positions}개 중 ${current.coverage.valued}개의 가격·환율 근거가 확인됩니다.`, `The full total and weights are unavailable. ${current.coverage.valued} of ${current.coverage.positions} holdings have price and currency evidence.`)}{!current.coverage.scopeComplete ? t(" 현금 또는 다른 보유 정보도 확인이 필요해요.", " Cash or other holdings also need verification.") : ""}</p> : null}
        {!current.complete ? <small>{t(`제외 ${current.coverage.excludedPositions}개 · 제외 비중은 금액 확인 후 제공`, `${current.coverage.excludedPositions} excluded · excluded weight needs missing values`)}</small> : null}
        {evidence.groupEvidence?.reason ? <p className={styles.notice}>{unavailable(evidence.groupEvidence.reason)}</p> : null}
        {report.movement ? <div className={styles.change}><span>{t("이전 기록 대비 평가액 변화", "Value change since previous record")}</span><strong>{money(report.movement.valuationChange)}</strong><small>{date(report.movement.from)}</small></div> : null}
        {evidence.ledgerComplete && (!surface || surface === "home" || surface === "history") ? <div className={styles.change}><span>{t("입출금 반영 기간 수익률", "Period return adjusted for cash flows")}</span><strong>{report.performanceReturn?.status === "ready" ? `${(report.performanceReturn.totalReturn * 100).toFixed(2)}%` : "—"}</strong><small>{report.performanceReturn?.status === "ready" ? `Modified Dietz · ${currency}` : t("기간별 평가와 입출금 근거가 필요해요.", "Dated values and cash flows are needed.")}</small></div> : null}
        {report.realizedPnl.coverage.sales > 0 && (!surface || surface === "home") ? <div className={styles.change}><span>{t("기록된 매도 누적 실현손익", "Realized P&L from recorded sales")}</span><strong>{money(report.realizedPnl.total)}</strong><small>{t("수수료 별도 · 매도 시점 환율과 원래 취득원가 기준", "Fees separate · sale-time FX and original acquisition costs")}{report.realizedPnl.status !== "ready" ? t(" · 원가 또는 해당 시점 환율 확인 필요", " · Dated cost or FX evidence is needed") : ""}</small></div> : null}
      </div>
      {current.complete && entries.length > 0 && (!surface || surface === "home" || surface === "structure") ? <div className={styles.ring}><PortfolioAllocationRing entries={entries} selectedKey={active?.id ?? ""} onSelect={setSelected} compositionOnly /></div> : null}
    </section>
    {showHoldings ? <section className={styles.section} aria-label={t("보유자산", "Holdings")}><h2>{t("보유자산", "Holdings")}</h2>
      <div className={styles.holdings}>{current.positions.map(row => <button type="button" key={row.id} aria-pressed={active?.id === row.id} onClick={() => setSelected(row.id)}><span>{row.name}{row.reason ? <small>{unavailable(row.reason)}</small> : null}</span><span><strong>{money(row.value)}</strong>{row.weightPct !== null ? <small>{row.weightPct.toFixed(2)}%</small> : null}</span></button>)}</div>
      {active ? <details className={styles.method}><summary>{active.name} · {t("평가 근거", "Valuation details")}</summary>{native ? <p>{t("원본 수량 × 원본 가격", "Original quantity × original price")} · {native.quantity} × {money(native.price, native.currency)} · {native.currency}</p> : null}<p>{t("시세 관측 시각", "Price observed")} · {active.priceObservedAt ? date(active.priceObservedAt) : "—"}</p><p>{t("근거가 있는 원가", "Cost with evidence")} · {money(active.cost)}</p><p>{t("조회한 보유자산의 평가입니다. 전체 재산이나 수익률을 뜻하지 않습니다.", "This values the included holdings. It is not total wealth or a performance return.")}</p></details> : null}
    </section> : null}

    {showMovement ? <section className={styles.section}><h2>{t("무엇이 변했나요?", "What changed?")}</h2>
      {report.movement?.attribution ? <><div className={styles.metrics}>{[[t("가격 영향", "Price effect"), report.movement.attribution.price], [t("환율 영향", "Currency effect"), report.movement.attribution.exchange], [evidence.ledgerComplete ? t("순입출금", "Net external cash flow") : t("종목 매매 반영", "Asset trade flow"), report.movement.attribution.assetTradeFlow], ...(evidence.ledgerComplete ? [[t("배당·비용 등", "Income and costs"), report.movement.attribution.otherCashReturn], [t("입출금 제외 변동", "Change excluding external flows"), report.movement.attribution.investmentChange]] : [])].map(([label, value]) => <div key={label}><p>{label}</p><strong>{money(value)}</strong></div>)}</div>{!evidence.ledgerComplete ? <p className={styles.note}>{t("계좌 전체의 입출금을 반영한 성과는 아닙니다.", "This does not adjust for portfolio-wide deposits and withdrawals.")}</p> : null}
      {surface === "today" ? <div className={styles.history}>{report.movement.attribution.positions.filter(row => Number(row.change) !== 0).toSorted((a,b) => Math.abs(Number(b.change))-Math.abs(Number(a.change))).map(row => <div key={row.id}><span>{row.name}</span><span><strong>{money(row.change)}</strong><small>{t("가격", "Price")} {money(row.price)} · {t("환율", "FX")} {money(row.exchange)}</small></span></div>)}</div> : null}</> : <p className={styles.notice}>{report.movement ? unavailable(report.movement.reason) : t("비교할 과거 평가 기록이 아직 없어요.", "A previous valuation record is needed for comparison.")}</p>}
    </section> : null}
    {showHistory ? <section className={styles.section}><h2>{t("확인된 평가 기록", "Dated valuations")}</h2>{report.history.length ? <div className={styles.history}>{[...report.history, current].map((frame, index) => <div key={`${frame.at}-${index}`}><span>{date(frame.at)}{index === report.history.length ? <small>{t("현재", "Current")}</small> : null}</span><span><strong>{money(frame.total)}</strong>{!frame.complete ? <small>{t("평가 근거 부족", "Incomplete valuation")}</small> : null}</span></div>)}</div> : <p className={styles.note}>{t("과거 수량과 가격 시각이 확인돼야 비교할 수 있어요.", "Dated quantity and price evidence is required for comparison.")}</p>}</section> : null}

    {showContribution && nativeContributionScopeKey ? <NativeContributionPlanner key={`${nativeContributionScopeKey}:${currency}`} scopeKey={nativeContributionScopeKey} currency={currency} /> : null}
    {showContribution && !nativeContributionScopeKey ? <details className={styles.contribution} open={surface === "contribution" ? true : undefined}><summary>{t("다음 투자금 나눠보기", "Plan a contribution")}</summary><p className={styles.note}>{t("목표 비중에 따른 계산이며 실제 주문이나 저장은 하지 않아요.", "A calculation against your targets. No orders are placed or saved.")}</p>
      {!current.complete || !contributionPolicy ? <p className={styles.notice}>{t("전체 보유자산의 평가와 적용할 정책을 확인한 뒤 계산할 수 있어요.", "A complete valuation and the applicable policy are needed first.")}</p> : <form onSubmit={calculate} noValidate className={styles.form}>
        <div className={styles.funds}><label>{t("새 투자금", "New money")}<MoneyInput value={cash} onValueChange={value => { setCash(value); invalidate(); }} allowDecimals={cashCurrency === "USD"} aria-label={t("새 투자금", "New money")} placeholder="0" /></label><label>{t("투자금 통화", "Money currency")}<select value={cashCurrency} onChange={event => { setCashCurrency(event.target.value as Currency); invalidate(); }}><option>KRW</option><option>USD</option></select></label></div>
        {cashPositions.length > 0 ? <label className={styles.cashChoice}><input type="checkbox" checked={useAvailableCash} onChange={event => { setUseAvailableCash(event.target.checked); invalidate(); }} />{t("보유 현금도 투자금으로 사용", "Use available cash as investment funds")}</label> : null}
        <p className={styles.note}>{t("목표 비중은 투자 종목끼리 계산해요. 보유 현금은 선택한 경우에만 투자금에 더합니다.", "Target weights compare securities. Available cash is added to spendable funds only when selected.")}</p>
        <div className={styles.targets}>{securityPositions.map(row => <label key={row.id}><span>{row.name}</span><span><input aria-label={`${row.name} ${t("목표 비중", "target weight")}`} inputMode="decimal" value={targets[row.id] ?? ""} onChange={event => { setTargets(previous => ({ ...previous, [row.id]: event.target.value })); invalidate(); }} placeholder="0" /> %</span></label>)}</div>
        <p className={styles.note}>{t("목표 비중 합계 100% · 원가 근거가 없는 자산은 매도하지 않아요. MA120 근거가 없어 감액은 적용하지 않습니다.", "Targets must total 100%. Holdings without cost evidence are not sold. No MA120 reduction is applied without evidence.")}</p>
        <button className={styles.primary} type="submit">{t("배분 계산", "Calculate allocation")}</button>{error ? <p role="alert" className={styles.notice}>{error}</p> : null}
      </form>}
      {currentCalculation?.status === "blocked" ? <p role="alert" className={styles.notice}>{unavailable(currentCalculation.reason)}</p> : null}
      {ready ? <section className={styles.calculation} aria-live="polite"><h3>{t("계산된 배분", "Calculated allocation")} · {ready.context.reportingCurrency}</h3><div className={styles.metrics}>{[[t("매수 합계", "Total buys"), ready.buys], [t("매도 합계", "Total sales"), ready.sales], [t("남는 현금", "Cash remaining"), ready.remainingCash]].map(([label, value]) => <div key={label}><p>{label}</p><strong>{resultMoney(Number(value))}</strong></div>)}</div>
        {ready.rows.map(row => <div className={styles.allocation} key={row.key}><strong>{current.positions.find(item => item.id === row.key)?.name}</strong><span>{t("매수", "Buy")} {resultMoney(row.buy)} · {t("매도", "Sell")} {resultMoney(row.sell)}</span><small>{row.beforePct.toFixed(2)}% → {row.afterPct.toFixed(2)}% · {t("목표", "Target")} {row.targetPct}%</small></div>)}
        <details className={styles.method}><summary>{t("계산 기준과 한계", "Calculation context and limits")}</summary><p>{t("평가·수익 판단 통화", "Valuation and profit currency")} · {ready.context.profitCurrency}</p><p>{t("평가 시각", "Valuation time")} · {date(ready.context.asOf)}</p><p>{t("과대비중 기준", "Overweight drift threshold")} · {contributionPolicy?.trimDriftThresholdPct}%</p><p>{t("정책 버전", "Policy version")} · {ready.context.policyVersion}</p><p>{t("각 원가의 원본 통화와 시점을 유지해 손실 여부를 판단합니다. 환전 스프레드·세금·수수료·수량 단위는 반영하지 않으며 목표에 정확히 도달하지 못할 수 있어요.", "Loss checks preserve each original cost currency and date. Spreads, taxes, fees and trade quantities are not included; target weights may not be reached exactly.")}</p></details>
      </section> : null}
    </details> : null}
    <details className={styles.method}><summary>{t("통화별 계산의 기준", "How currency comparisons work")}</summary><p>{t("각 평가 시점의 수량 × 원본 가격 × 해당 시점의 환율로 다시 계산합니다. 원화 평가액에 오늘의 환율만 나누지 않습니다.", "Every valuation is recalculated from quantity × native price × the exchange rate at that time. Historical KRW totals are not divided by today’s rate.")}</p><p>{evidence.ledgerComplete ? t("기록한 배당·수수료·환전 비용은 현금 잔액에 반영합니다. 입출금은 수익에서 제외하며 기간 수익률은 실제 입출금 시각을 반영한 Modified Dietz 추정치입니다.", "Recorded income, fees and conversion costs are included in cash. External flows are excluded from gains; period returns use Modified Dietz estimates weighted by actual flow times.") : t("과거 평가와 입출금 근거가 모두 확인돼야 기간 수익률을 계산할 수 있어요.", "Period returns require dated valuations and external cash-flow evidence.")}</p></details>
  </main>;
}
