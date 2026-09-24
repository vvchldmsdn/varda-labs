"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { buildCurrencyResearch, type CurrencyResearchInput, type CurrencyResearchResult } from "@/lib/currency-research";
import { formatMoney, type Currency } from "@/lib/money";
import { PortfolioAllocationRing } from "@/components/portfolio/portfolio-allocation-ring";
import { buildCurrencyInvestmentLabCounterfactual } from "@/lib/investment-lab-counterfactual-path";
import styles from "./currency-research-view.module.css";

const REASONS: Record<string, string> = {
  corporate_action_evidence_missing: "주식 분할·병합 등 기업행사 확인이 필요해 수익률 계산을 보류합니다.",
  invalid_input: "입력 금액과 계산 기간을 확인해 주세요.", future_valuation: "입력 기준 시각이 분석 시각보다 이후입니다.",
  fx_missing: "이 날짜의 통화 환산 근거가 없습니다.", fx_stale: "이 날짜에 사용할 환율 근거가 오래됐습니다.", fx_invalid: "환율 근거를 확인할 수 없습니다.", future_evidence: "해당 날짜 이전 환율이 필요합니다.",
  instrument_unidentified: "종목을 선택해야 해당 시장 이력을 연결할 수 있습니다.", valuation_incomplete: "모든 입력 금액을 같은 통화로 환산할 수 없습니다.",
  comparison_weights_invalid: "실험 비중은 각각 0~100%, 합계 100%로 입력해 주세요.",
  history_missing: "이 종목의 검증된 가격 이력이 아직 없습니다.", insufficient_history: "함께 비교할 수 있는 수익률 이력이 최소 30개 필요합니다.", history_stale: "최근 가격 이력이 부족해 분석을 잠시 보류합니다.",
  history_admission_mismatch: "가격의 출처·통화·수정 기준을 확인할 수 없습니다.", price_basis_mismatch: "가격 이력의 통화나 수정 기준이 일치하지 않습니다.",
  history_axis_invalid: "가격 이력의 날짜 순서를 확인할 수 없습니다.", history_axis_mismatch: "종목마다 관측 날짜가 달라 같은 조건으로 비교할 수 없습니다.",
  duplicate_instrument_history: "종목의 가격 이력이 중복되어 확인이 필요합니다.", invalid_return: "유효하지 않은 수익률 관측이 있습니다.", path_calculation_invalid: "경로 계산을 완료하지 못했습니다.", invalid_value: "유효한 가격·금액 근거가 필요합니다.",
};
const REASONS_EN: Record<string, string> = {
  corporate_action_evidence_missing: "Return analysis awaits verified corporate-action evidence, including stock splits.",
  "invalid_input": "Check the amounts and analysis horizon.",
  "future_valuation": "The input valuation is later than the analysis time.",
  "fx_missing": "No dated exchange-rate evidence is available.",
  "fx_stale": "The exchange-rate evidence is too old for this date.",
  "fx_invalid": "Exchange-rate evidence could not be verified.",
  "future_evidence": "An exchange-rate observation on or before this date is needed.",
  "instrument_unidentified": "Choose an instrument to connect verified market history.",
  "valuation_incomplete": "Not all entered amounts can be converted to the same currency.",
  "comparison_weights_invalid": "Each experimental weight must be 0–100%, totaling 100%.",
  "history_missing": "Verified price history is not available for this instrument.",
  "insufficient_history": "At least 30 aligned return observations are required.",
  "history_stale": "Recent price history is unavailable.",
  "history_admission_mismatch": "Price source, currency or adjustment basis could not be verified.",
  "price_basis_mismatch": "Price history uses incompatible currency or adjustment bases.",
  "history_axis_invalid": "Price dates could not be validated.",
  "history_axis_mismatch": "Instrument dates do not align for a fair comparison.",
  "duplicate_instrument_history": "Duplicate instrument histories need review.",
  "invalid_return": "A return observation is invalid.",
  "path_calculation_invalid": "Path calculation could not finish.",
  "invalid_value": "Valid price and valuation evidence is required."
};
const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
function inputTimestamp(at: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

type ResearchSurface = "lab" | "simulation" | "structure";
export function CurrencyResearchView({ evidence, surface, hideCurrencyControl = false }: { evidence: CurrencyResearchInput; surface?: ResearchSurface; hideCurrencyControl?: boolean }) {
  // A different saved input must not inherit another draft's experimental weights.
  return <CurrencyResearchWorkspace key={`${JSON.stringify(evidence.input)}:${evidence.reportingCurrency}:${surface}`} evidence={evidence} surface={surface} hideCurrencyControl={hideCurrencyControl} />;
}

function CurrencyResearchWorkspace({ evidence, surface, hideCurrencyControl }: { evidence: CurrencyResearchInput; surface?: ResearchSurface; hideCurrencyControl: boolean }) {
  const { t, locale: language } = useI18n();
  const [currency, setCurrency] = useState<Currency>(evidence.reportingCurrency);
  const [result, setResult] = useState<CurrencyResearchResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [comparison, setComparison] = useState<readonly number[] | undefined>(evidence.comparisonWeights);
  const [fields, setFields] = useState<string[] | null>(null);
  const [selected, setSelected] = useState("0");
  const [horizon, setHorizon] = useState(evidence.horizon ?? 126);
  const [step, setStep] = useState(evidence.horizon ?? 126);
  const owned = evidence.provenance === "owned_native_history" && evidence.input.version === 3;
  const actual = owned && evidence.actualPortfolio?.reportingCurrency === currency ? evidence.actualPortfolio : null;
  const selectedGroup = actual?.boundary === "selected_group";
  const scenarios = evidence.histories.filter(history => history.admission !== "native_cash");
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.instrumentId ?? "");
  const sameFlow = useMemo(() => {
    const scenario = evidence.histories.find(history => history.instrumentId === scenarioId);
    return owned && surface !== "structure" && surface !== "simulation" && evidence.counterfactual?.reportingCurrency === currency && scenario
      ? buildCurrencyInvestmentLabCounterfactual({ evidence: evidence.counterfactual, scenario, fx: evidence.fx, maxFxAgeMs: 3 * 86400000 }) : null;
  }, [evidence, currency, owned, scenarioId, surface]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true); setFailed(false);
      void buildCurrencyResearch({ ...evidence, reportingCurrency: currency, comparisonWeights: comparison, horizon, calculation: surface === "structure" ? "risk_only" : evidence.calculation }).then(value => {
        if (!cancelled) { setResult(value); setBusy(false); }
      }).catch(() => { if (!cancelled) { setFailed(true); setBusy(false); } });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [evidence, currency, comparison, horizon, surface]);
  const rows = result?.composition.rows ?? [];
  const roundedFields = rows.map(row => ((row.weight ?? 0) * 100).toFixed(2));
  if (result?.composition.complete && roundedFields.length) roundedFields[roundedFields.length - 1] = (100 - roundedFields.slice(0, -1).reduce((sum, text) => sum + Number(text), 0)).toFixed(2);
  const displayFields = fields ?? roundedFields;
  const sum = displayFields.reduce((value, text) => value + Number(text), 0);
  const validWeights = displayFields.length === evidence.input.rows.length && displayFields.every(text => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0 && Number(text) <= 100) && Math.abs(sum - 100) < 1e-6;
  const locale = language === "en" ? "en-US" : "ko-KR";
  const entries = rows.map((row, index) => ({ key: String(index), name: row.name, weightPct: (row.weight ?? 0) * 100 }));
  const issues = result?.issues ?? [];
  const unavailable = <div className={styles.unavailable}><strong>{t("분석에 필요한 근거가 아직 부족해요.", "More evidence is needed for this analysis.")}</strong>{issues.length ? <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.rowIndex !== undefined ? `${evidence.input.rows[issue.rowIndex]?.name} · ` : ""}{t(REASONS[issue.code] ?? "계산 근거를 확인해 주세요.", REASONS_EN[issue.code] ?? "Please review the calculation evidence.")}</li>)}</ul> : <p>{t("종목을 선택하고 확인된 시장 이력이 연결되면 계산할 수 있어요.", "Choose instruments and connect verified market history to calculate.")}</p>}<p>{t("확인된 일부만 다시 100%로 맞추거나 빈 이력을 채우지 않습니다.", "Missing assets and dates are never filled or reweighted away.")}</p></div>;
  const riskDetails = result?.risk ? <>
    <div className={styles.metrics}><div><span>{t("연율화 변동성", "Annualized volatility")}</span><strong>{result.risk.volatilityPct.toFixed(2)}%</strong></div><div><span>{t("함께 비교한 수익률", "Aligned return observations")}</span><strong>{result.risk.observations}{t("개", " observations")}</strong></div></div>
    {result.risk.sharpe !== null || result.risk.beta !== null ? <div className={styles.metrics}>
      {result.risk.sharpe !== null ? <div><span>Sharpe</span><strong>{result.risk.sharpe.toFixed(2)}</strong><small>{result.risk.provenance.riskFree?.identity}</small></div> : null}
      {result.risk.beta !== null ? <div><span>Beta</span><strong>{result.risk.beta.toFixed(2)}</strong><small>{result.risk.provenance.benchmark?.identity.name}</small></div> : null}
    </div> : null}
    <p className={styles.note}>{t("현재 비중을 유지했다고 가정한 위험입니다. Sharpe와 Beta는 같은 통화·수익률 기준·관측 기간의 근거가 확인된 지표만 표시합니다.", "Risk assumes constant current weights. Sharpe and Beta appear only with verified evidence matching the currency, return basis and observation intervals.")}</p>
    {result.risk.sharpe === null || result.risk.beta === null ? <p className={styles.note}>{t("일치하는 금리·벤치마크 근거가 없는 지표는 제공하지 않습니다.", "Metrics without matching rate or benchmark evidence remain unavailable.")}</p> : null}
  </> : unavailable;
  if (surface === "structure") return <section className={styles.section} aria-labelledby="native-structure-risk"><div className={styles.sectionHeading}><span>{t("과거 시장에서 본 위험", "Risk from historical markets")} · {currency}</span><h2 id="native-structure-risk">{t("현재 구성의 변동성", "Volatility of your current allocation")}</h2><p>{t("현재 보유 종목과 현금의 비중을 같은 날짜의 과거 수익률에 적용합니다. 실제 개인 수익률과는 별도의 위험 추정치입니다.", "Apply your current holdings and cash weights to historical returns from matching dates. This is a risk estimate, separate from your actual personal return.")}</p></div><div aria-live="polite">{busy ? <p className={styles.loading}>{t("통화별 위험을 계산하고 있어요…", "Calculating currency-specific risk…")}</p> : failed ? <p className={styles.unavailable}>{t("위험 계산에 필요한 이력을 확인할 수 없어요.", "The history needed for risk calculation is unavailable.")}</p> : riskDetails}</div></section>;
  return <main id="varda-main-content" className={styles.workspace}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{t("내 구성으로 보는 가상 실험", "A hypothetical experiment with your allocation")}</p><h1>{surface === "lab" ? (owned ? t("같은 입출금, 다른 선택", "The same cash flows, a different choice") : t("다른 비중이었다면?", "What if the weights were different?")) : surface === "simulation" ? t("1,000개의 가능한 경로", "1,000 possible paths") : t("통화를 바꾸면, 관점도 달라집니다.", "A different currency. A different perspective.")}</h1><p>{owned ? t("현재 보유 종목과 현금의 비중을 과거 시장에 적용하는 가상 비교입니다. 실제 매매 이력과는 구분됩니다.", "This hypothetical comparison applies your current holdings and cash weights to past markets. It is separate from your actual trading record.") : t("입력한 금액의 비중을 과거 시장에 적용해 비교합니다. 실제 투자 이력이나 미래 예측은 아닙니다.", "Compare your entered allocation using historical markets. This is hypothetical, not your investment record or a forecast.")}</p></div>{!hideCurrencyControl ? <label className={styles.currency}>{t("분석 기준 통화", "Analysis currency")}<select value={currency} onChange={event => { setBusy(true); setCurrency(event.target.value as Currency); }}><option value="KRW">{t("KRW · 원", "KRW · Korean won")}</option><option value="USD">{t("USD · 달러", "USD · US dollar")}</option></select><span>{t("각 날짜의 환율로 다시 계산", "Recalculated with dated exchange rates")}</span></label> : <span>{currency}</span>}</header>
    {evidence.provenance === "synthetic_fixture" ? <p className={styles.sample}>{t("개발용 가상 데이터 · 실제 시세와 투자 성과가 아닙니다.", "Synthetic development data · Not actual prices or investment results.")}</p> : null}
    <p className={styles.note}>{t("입력 기준", "Input as of")} {inputTimestamp(evidence.input.asOf ?? evidence.asOf, evidence.input.timeZone ?? "Asia/Seoul")} · {evidence.input.timeZone ?? "Asia/Seoul"}</p>
    {actual && surface !== "simulation" ? <section className={styles.section} aria-labelledby="research-actual"><h2 id="research-actual">{t("실제 기록에서 확인한 성과", "Performance from your actual records")}</h2><div className={styles.metrics}><div><span>{selectedGroup ? t("선택 그룹 · 외부 자금 반영 Modified Dietz", "Selected group · Modified Dietz with external flows") : t("현금·입출금 포함 Modified Dietz", "Modified Dietz including cash and external flows")}</span><strong>{actual.totalReturnPct === null ? "—" : pct(actual.totalReturnPct)}</strong></div><div><span>{t("평가 기록", "Valuation records")}</span><strong>{actual.valuationCount}</strong></div></div><p className={styles.note}>{actual.from ? `${inputTimestamp(actual.from, evidence.input.timeZone ?? "Asia/Seoul")} ~ ${inputTimestamp(actual.to, evidence.input.timeZone ?? "Asia/Seoul")}` : t("비교할 과거 평가 기록이 필요해요.", "A previous valuation record is needed.")}</p><p className={styles.note}>{actual.totalReturnPct === null ? t("전체 평가와 해당 기간의 입출금 근거가 갖춰지면 표시해요.", "Shown once complete valuations and external-flow evidence are available for the period.") : selectedGroup ? t("선택 범위를 오간 자금을 반영합니다. 종목만 선택한 계좌의 현금은 포함하지 않습니다.", "Reflects funds crossing the selected scope. Cash is excluded from accounts selected only through individual holdings.") : t("실제 보유·현금·거래를 반영한 기록입니다. 같은 입출금 비교는 실제 관측 기간을, 비중 실험은 별도의 과거 시장 기간을 사용합니다.", "These records reflect actual holdings, cash and transactions. The same-flow comparison uses the actual observation window; the weight experiment uses its own historical market window.")}</p></section> : null}
    {owned && surface !== "simulation" && evidence.counterfactual ? <section className={styles.section} aria-labelledby="research-same-flow">
      <h2 id="research-same-flow">{t("같은 입출금, 한 종목이었다면?", "The same cash flows, in one instrument")}</h2>
      <label className={styles.currency}>{t("직접 비교할 보유 종목", "Choose an owned instrument")}<select value={scenarioId} onChange={event => setScenarioId(event.target.value)}>{scenarios.map(history => <option key={history.instrumentId} value={history.instrumentId}>{evidence.input.rows.find(row => row.instrumentId === history.instrumentId)?.name ?? history.instrumentId}</option>)}</select></label>
      <p className={styles.note}>{t("선택 범위의 첫 평가액을 한 종목에 투자하고, 같은 날짜·금액의 외부 자금을 반영합니다. 가상 거래비용과 배당 재투자는 제외합니다.", "Invest the selected scope’s initial value in one instrument, then apply the same dated external flows. Hypothetical costs and dividend reinvestment are excluded.")}</p>
      {sameFlow?.status === "ready" ? <>
        <ComparisonChart kind="actual" points={sameFlow.rows.map(row => ({ at: row.at, current: row.actualValue / sameFlow.rows[0].actualValue * 100, comparison: row.alternativeValue / sameFlow.rows[0].actualValue * 100 }))} />
        <div className={styles.metrics}><div><span>{t("실제 성과", "Actual return")}</span><strong>{pct(sameFlow.actualReturnPct)}</strong></div><div><span>{t("같은 입출금의 가상 성과", "Alternative with the same flows")}</span><strong>{pct(sameFlow.alternativeReturnPct)}</strong></div><div><span>{t("차이", "Difference")}</span><strong>{sameFlow.returnDifferencePct.toFixed(2)}%p</strong></div></div>
        <p className={styles.note}>{t("차트는 시작 평가액을 100으로 둔 자산 경로이며 입출금도 반영합니다. 수익률은 같은 관측 기간과 실제 입출금 시각으로 계산한 Modified Dietz 추정치입니다. 종가 확인 전 대기 금액은 기준 통화 현금 또는 출금 의무로 반영합니다.", "The chart indexes starting wealth to 100 and includes cash flows. Returns are Modified Dietz estimates using the same observed periods and actual flow timestamps. Amounts awaiting an eligible close remain reporting-currency cash or withdrawal obligations.")}</p>
      </> : <p className={styles.unavailable}>{sameFlow?.reason === "corporate_action_evidence_missing" ? t(REASONS.corporate_action_evidence_missing, REASONS_EN.corporate_action_evidence_missing) : t("실제 평가·입출금과 선택 종목의 해당 날짜 가격·환율이 모두 확인되어야 비교할 수 있어요.", "Comparison requires complete actual valuations, external flows and the selected instrument’s dated prices and FX.")}</p>}
    </section> : null}
    <div aria-live="polite" role="status">{busy ? <p className={styles.loading}>{t("통화별 수익률과 1,000개 경로를 계산하고 있어요…", "Recalculating currency returns and 1,000 paths…")}</p> : failed ? <p className={styles.unavailable}>{t("계산을 완료하지 못했어요. 분석 통화를 다시 선택해 주세요.", "Calculation could not finish. Select the analysis currency again.")}</p> : null}</div>
    {!busy && !failed && result ? <>
      {!surface ? <section className={styles.section} aria-labelledby="research-structure"><div className={styles.sectionHeading}><span>{t("01 / 구성과 위험", "01 / Composition & risk")}</span><h2 id="research-structure">{t("현재 입력, 하나의 포트폴리오로", "Your inputs, one portfolio")}</h2></div>
        <div className={styles.twoColumns}><div>{result.composition.complete ? <PortfolioAllocationRing entries={entries} selectedKey={selected} onSelect={setSelected} compositionOnly /> : <p className={styles.unavailable}>{t("통화 환산이 완료되면 전체 비중을 표시합니다.", "Full weights are shown once all currency conversions are available.")}</p>}</div><div><p className={styles.total}>{result.composition.total !== null ? formatMoney(result.composition.total, currency, locale) : t("전체 금액 확인 필요", "Total needs verification")}</p><div className={styles.assetList}>{rows.map((row, index) => <button type="button" key={index} aria-pressed={selected === String(index)} onClick={() => setSelected(String(index))}><span>{row.name}</span><strong>{row.weight === null ? "—" : `${(row.weight * 100).toFixed(1)}%`}</strong></button>)}</div>
          {riskDetails}</div></div>
      </section> : null}
      {!surface || surface === "lab" ? <section className={styles.section} aria-labelledby="research-lab"><div className={styles.sectionHeading}><span>{t("02 / 투자 랩", "02 / Investment Lab")}</span><h2 id="research-lab">{t("비중만 달랐다면 어땠을까요?", "What if the weights were different?")}</h2><p>{t("같은 기간·같은 통화로, 직접 정한 비중과 현재 구성을 비교합니다.", "Compare your chosen weights with the current allocation, over the same dates and in the same currency.")}</p></div>
        <div className={styles.twoColumns}><form className={styles.weights} onSubmit={event => { event.preventDefault(); if (validWeights) { setBusy(true); setComparison(displayFields.map(value => Number(value) / 100)); } }}><p className={styles.note}>{t("실험 비중 · 실제 보유 정보는 바뀌지 않습니다.", "Experimental weights · Your actual holdings remain unchanged.")}</p>{evidence.input.rows.map((row, index) => <label key={index}><span>{row.name}</span><div><input type="text" inputMode="decimal" aria-label={`${row.name} ${t("실험 비중", "experimental weight")}`} value={displayFields[index] ?? ""} onChange={event => { const updated = [...displayFields]; updated[index] = event.target.value; setFields(updated); }} /><span>%</span></div></label>)}<p className={validWeights ? styles.note : styles.error}>{t("합계", "Total")} {Number.isFinite(sum) ? sum.toFixed(2) : "—"}% · {t("100%로 맞춰 주세요.", "Set the total to 100%.")}</p><button className={styles.primary} disabled={!validWeights} type="submit">{t("이 비중으로 비교하기", "Compare these weights")}</button></form><div>{result.lab ? <><ComparisonChart points={result.lab.points} /><div className={styles.metrics}><div><span>{t("현재 구성", "Current allocation")}</span><strong>{pct(result.lab.currentReturnPct)}</strong></div><div><span>{t("실험 구성", "Experimental allocation")}</span><strong>{pct(result.lab.comparisonReturnPct)}</strong></div></div><p className={styles.note}>{t("시작값 100 · 관측일마다 비중 유지 가정 · 수수료·세금 제외", "Starts at 100 · Weights reset each observation · Fees and taxes excluded")}</p></> : unavailable}</div></div>
      </section> : null}
      {!surface || surface === "simulation" ? <section className={styles.section} aria-labelledby="research-simulation"><div className={styles.sectionHeading}><span>{t("03 / 시뮬레이션", "03 / Simulation")}</span><h2 id="research-simulation">{t("같은 과거, 1,000가지 순서", "One history, 1,000 possible sequences")}</h2><p>{t("과거의 연속된 변화를 묶어 다시 뽑습니다. 모든 자산에 같은 날짜를 적용합니다.", "Resample consecutive historical changes in blocks. Every asset uses the same sampled dates.")}</p></div>{result.simulation ? <><label className={styles.currency}>{t("계산 기간 · 시장 관측 수", "Horizon · Market observations")}<select value={horizon} onChange={event => { const next = Number(event.target.value); setBusy(true); setHorizon(next); setStep(next); }}>{(owned && surface === "simulation" ? [63, 126] : [30, 126, 252]).map(value => <option key={value} value={value}>{value}{t("개 관측", " observations")}</option>)}</select></label><PathCanvas paths={result.simulation.paths} /><label className={styles.scrubber}>{t("경로의 위치", "Path position")} · {step} {t("번째 관측", "observations")}<input type="range" min="0" max={result.simulation.horizon} value={step} onChange={event => setStep(Number(event.target.value))} /></label><div className={styles.metrics}>{[t("낮은 10%", "10th percentile"), t("중앙값", "Median"), t("높은 10%", "90th percentile")].map((label, i) => <div key={label}><span>{label} · {t("시작값 100", "Starts at 100")}</span><strong>{([result.simulation!.summary.bands[step]?.p10, result.simulation!.summary.bands[step]?.p50, result.simulation!.summary.bands[step]?.p90][i])?.toFixed(1) ?? "—"}</strong></div>)}</div><p className={styles.note}>{result.simulation.horizon} {t("개 시장 관측 이후, 모형 안에서 손실로 끝난 비율", "observations ahead: model paths ending in loss")} {result.simulation.summary.terminal?.lossProbabilityPct.toFixed(1)}%. {t("미래의 실제 손실 확률을 보장하지 않습니다.", "This is not a guaranteed future loss probability.")}</p></> : unavailable}</section> : null}
      <details className={styles.method}><summary>{t("계산 방법과 데이터 근거", "Method and data evidence")}</summary><p>{t("날짜별 환산 가격 P(t) × 해당 날짜 환율 F(t)를 먼저 계산하고, 수익률 = 환산 가격(t) ÷ 환산 가격(t−1) − 1을 구합니다. 같은 통화면 F(t)=1입니다.", "First calculate P(t) × the dated FX factor F(t). Return = converted price(t) ÷ converted price(t−1) − 1. For the same currency, F(t)=1.")}</p><p>{t("포트폴리오 변화 = Σ(비중 × 종목 수익률). 비중을 매 관측마다 유지하는 가상 실험이며, 매매 비용과 신규 입출금은 포함하지 않습니다. 시뮬레이션은 평균 5개 관측의 연속 블록을 재추출하고 과거 마지막에서 처음으로 순환합니다. 새 금리·환율 전망은 생성하지 않습니다.", "Portfolio return = Σ(weight × instrument return). This hypothetical experiment resets weights each observation, without trading costs or external flows. Simulation resamples blocks averaging 5 observations, wrapping from the end to the start of history. It generates no new interest-rate or FX forecasts.")}</p><p>{t("출처", "Sources")}: {result.metadata.sources.join(", ") || t("확인된 이력 없음", "No verified history")}. {t("가격 기준", "Price basis")}: {result.metadata.bases.map(basis => basis === "raw_price" ? t("수정 전 종가 (배당·기업행사 조정 없음)", "Raw close (no distribution or corporate-action adjustment)") : t("제공처 수정 가격 (총수익 보장 없음)", "Provider adjusted prices (total return not guaranteed)")).join(", ") || t("미확인", "Unverified")}.</p><p>{t("주식 분할·병합을 확인한 가격만 사용합니다. 배당금 재투자는 포함하지 않는 가격 수익률이며, 배당락에 따른 가격 하락도 그대로 남습니다.", "Only prices with verified split and corporate-action evidence are used. Returns exclude reinvested dividends; ex-dividend price drops remain in price-only returns.")}</p><p>{t("관측 범위", "Observation window")} {result.metadata.firstObservation?.slice(0, 10) ?? "—"} ~ {result.metadata.lastObservation?.slice(0, 10) ?? "—"} · {t("계산 버전", "Model version")} {result.metadata.version}</p></details>
    </> : null}
  </main>;
}

function ComparisonChart({ points, kind = "weights" }: { points: NonNullable<CurrencyResearchResult["lab"]>["points"]; kind?: "weights" | "actual" }) {
  const { t } = useI18n();
  const values = points.flatMap(point => [point.current, point.comparison]);
  const min = Math.min(...values) * .99, max = Math.max(...values) * 1.01;
  const firstAt = Date.parse(points[0]?.at ?? ""), timeSpan = Date.parse(points.at(-1)?.at ?? "") - firstAt;
  const path = (key: "current" | "comparison") => points.map((point, index) => `${index === 0 ? "M" : "L"}${((kind === "actual" && timeSpan > 0 ? (Date.parse(point.at) - firstAt) / timeSpan : index / Math.max(1, points.length - 1)) * 580 + 10).toFixed(2)},${(230 - (point[key] - min) / (max - min) * 210).toFixed(2)}`).join(" ");
  return <figure className={styles.chart}><svg viewBox="0 0 600 250" role="img" aria-label={kind === "actual" ? t("동일한 외부 입출금을 적용한 실제 자산과 가상 자산 경로", "Actual and alternative wealth with identical external cash flows") : t("같은 과거 기간에서 현재 비중과 실험 비중의 가상 성과 비교", "Hypothetical current and experimental allocation comparison over the same historical dates")}><path d={path("current")} fill="none" stroke="var(--ink)" strokeWidth="2" /><path d={path("comparison")} fill="none" stroke="var(--accent)" strokeWidth="2" /></svg><figcaption><span>{kind === "actual" ? t("실제 기록 —", "Actual records —") : t("현재 구성 —", "Current allocation —")}</span><span className={styles.accent}>{kind === "actual" ? t("같은 입출금의 가상 경로 —", "Alternative with the same flows —") : t("실험 구성 —", "Experimental allocation —")}</span></figcaption></figure>;
}

function PathCanvas({ paths }: { paths: number[][] }) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const width = canvas.clientWidth, height = 300, scale = window.devicePixelRatio || 1;
      canvas.width = width * scale; canvas.height = height * scale;
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      ctx.scale(scale, scale); let min = 1, max = 1;
      paths.forEach(path => path.forEach(value => { min = Math.min(min, value); max = Math.max(max, value); }));
      const span = max - min || .1;
      ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#ef5a32";
      ctx.globalAlpha = .065; ctx.lineWidth = .7;
      paths.forEach(path => { ctx.beginPath(); path.forEach((value, index) => { const x = 8 + index / (path.length - 1) * (width - 16), y = height - 12 - (value - min) / span * (height - 24); if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke(); });
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => observer.disconnect();
  }, [paths]);
  return <canvas ref={ref} className={styles.canvas} role="img" aria-label={t("과거의 같은 날짜 변화를 재추출한 1,000개 가상 경로", "1,000 hypothetical paths from joint historical date resampling")}>{t("과거의 같은 날짜 변화를 재추출한 1,000개 가상 경로. 아래 구간 요약으로 값을 확인할 수 있습니다.", "1,000 hypothetical paths using joint historical date resampling. Explore values with the summary below.")}</canvas>;
}
