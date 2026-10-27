import { convertMoney, reportingReturnSeries, type FxEvidence, type NativeReturnPoint } from "./currency-valuation.ts";
import { Decimal, MONEY_VERSION, isCurrency, type Currency } from "./money.ts";
import { QUICK_INSTRUMENTS, validateQuickPortfolio, type QuickInput } from "./quick-portfolio.ts";
import { sampleCovarianceMatrix, standardDeviations, correlationMatrixFromCovariance, weightedSeries, sampleVariance } from "./portfolio-risk-statistics.ts";
import { createMulberry32 } from "./simulation-prng.ts";
import { summarizeSimulationNavPaths } from "./simulation-nav-path-summary.ts";
import type { CurrencyCounterfactualEvidence } from "./investment-lab-counterfactual-path.ts";
import { calculateCurrencyReferenceMetrics, type CurrencyBenchmarkEvidence, type CurrencyRiskFreeEvidence } from "./currency-reference-evidence.ts";

export const CURRENCY_RESEARCH_POLICY = Object.freeze({
  version: "amount_currency_research_v2", moneyVersion: MONEY_VERSION,
  purpose: "current_amount_composition_hypothetical", portfolioRule: "constant_weights_rebalanced_each_observation_without_costs",
  minimumReturns: 30, maximumReturns: 252, maxFxAgeMs: 3 * 86_400_000, maxHistoryAgeMs: 10 * 86_400_000,
  pathCount: 1000, seed: 20260914, expectedBlockLength: 5, annualizationFactor: 252,
  sampling: "stationary_bootstrap_joint_date_rows", missing: "block_without_dropping_or_renormalizing",
  corporateActions: "verified_covered_no_actions_or_provider_split_adjusted_price_only",
  forecast: "none", persistence: "none",
} as const);

/** The server loader must first apply asset-price-consumer-admission to stored prices.
 * This envelope never upgrades arbitrary adjusted prices into total-return evidence. */
export type CurrencyResearchHistory = Readonly<{
  instrumentId: string; source: string;
  admission: "shared_kis_raw" | "provider_adjusted" | "normalized_provider_raw" | "native_cash" | "synthetic_fixture";
  corporateActions?: Readonly<{ status: "unknown" | "verified_no_actions" | "verified_split_adjusted" | "synthetic_none"; source: string; from: string; through: string }>;
  points: readonly NativeReturnPoint[];
}>;
export type OwnedResearchComposition = { version: 3; source: "owned_native"; ownerId: string; currency: Currency; asOf: string; timeZone: string; rows: { name: string; value: number; inputCurrency: Currency; instrumentId: string; nativeCurrency: Currency }[] };
export type CurrencyResearchInput = Readonly<{
  input: QuickInput | OwnedResearchComposition; reportingCurrency: Currency; asOf: string;
  histories: readonly CurrencyResearchHistory[]; fx: readonly FxEvidence[];
  provenance: "stored_market_history" | "owned_native_history" | "synthetic_fixture";
  comparisonWeights?: readonly number[]; horizon?: number;
  calculation?: "risk_only";
  /** Requested market-history endpoint; current owned weights keep their own asOf. */
  historyEndAt?: string;
  /** Independently calculated from the owner's recorded valuations and actual
   * external cash flows. Never inferred from the current-weight backcast. */
  actualPortfolio?: Readonly<{ reportingCurrency: Currency; from: string | null; to: string; valuationCount: number; totalReturnPct: number | null; method: "modified_dietz_including_cash" | "modified_dietz_selected_group"; boundary: "portfolio_including_cash" | "selected_group"; reason: string | null }>;
  counterfactual?: CurrencyCounterfactualEvidence;
  /** Optional server-admitted series. No currency conversion or default rate. */
  benchmark?: CurrencyBenchmarkEvidence | null;
  riskFree?: CurrencyRiskFreeEvidence | null;
}>;
export type ResearchIssue = { code: string; rowIndex?: number };
type CompositionRow = { name: string; instrumentId: string | null; nativeCurrency: Currency | null; value: number | null; weight: number | null };
type LabPoint = { at: string; current: number; comparison: number };
type Risk = { volatilityPct: number; correlation: (number | null)[][]; observations: number } & ReturnType<typeof calculateCurrencyReferenceMetrics>;
type Simulation = { pathCount: 1000; horizon: number; paths: number[][]; summary: ReturnType<typeof summarizeSimulationNavPaths> };
export type CurrencyResearchResult = {
  status: "ready" | "incomplete";
  metadata: { version: string; reportingCurrency: Currency; asOf: string; valuationAsOf: string; source: CurrencyResearchInput["provenance"]; datasets: readonly string[]; bases: readonly string[]; sources: readonly string[]; firstObservation: string | null; lastObservation: string | null; cacheIdentity: string; policy: typeof CURRENCY_RESEARCH_POLICY;
    modelProvenance: { modelKind: "generic_portfolio_bootstrap"; modelId: string; reportingCurrency: Currency; returnBasis: "price_return" | "total_return" | "mixed_price_and_total_return"; fxBasis: "dated_native_to_reporting_before_return"; factorDataVersion: null; rateSource: CurrencyRiskFreeEvidence["source"] | null; benchmarkSource: CurrencyBenchmarkEvidence["source"] | null; calibrationPeriod: { from: string; to: string; observations: number } | null; seed: number; horizon: number };
  };
  composition: { rows: CompositionRow[]; total: number | null; complete: boolean };
  issues: ResearchIssue[];
  risk: Risk | null; lab: { points: LabPoint[]; currentReturnPct: number; comparisonReturnPct: number; weights: readonly number[] } | null;
  simulation: Simulation | null;
};

/** Currency-specific analysis of amounts, never observed personal performance or holdings. */
export async function buildCurrencyResearch(options: CurrencyResearchInput): Promise<CurrencyResearchResult> {
  const policy = CURRENCY_RESEARCH_POLICY;
  const owned = options.input.version === 3 ? options.input : null;
  const valid = owned ? (options.provenance === "owned_native_history" && owned.source === "owned_native" && !!owned.ownerId && owned.rows.length > 0 && owned.rows.length <= 200 && owned.rows.every(row => row.name && row.instrumentId && isCurrency(row.nativeCurrency) && isCurrency(row.inputCurrency) && Number.isFinite(row.value) && row.value >= 0) ? { ok: true as const, input: owned } : { ok: false as const }) : validateQuickPortfolio(options.input);
  const horizon = options.horizon ?? 126;
  const issues: ResearchIssue[] = [];
  if (options.calculation !== undefined && options.calculation !== "risk_only") issues.push({ code: "invalid_input" });
  if (!valid.ok || !isCurrency(options.reportingCurrency) || !["stored_market_history", "owned_native_history", "synthetic_fixture"].includes(options.provenance) || !Number.isFinite(Date.parse(options.asOf)) || !Number.isInteger(horizon) || horizon < 1 || horizon > 252) issues.push({ code: "invalid_input" });
  const historyEndAt = options.historyEndAt ?? options.asOf;
  if (!Number.isFinite(Date.parse(historyEndAt)) || Date.parse(historyEndAt) > Date.parse(options.asOf)) issues.push({ code: "invalid_input" });
  const datasets = [...new Set(options.histories.flatMap(history => history.points.map(point => point.dataset)))].sort();
  const metadata: CurrencyResearchResult["metadata"] = {
    version: policy.version, reportingCurrency: options.reportingCurrency, asOf: options.asOf,
    valuationAsOf: options.input.asOf ?? options.asOf, source: options.provenance, datasets,
    bases: [...new Set(options.histories.flatMap(history => history.points.map(point => point.basis)))].sort(),
    sources: [...new Set([...options.histories.flatMap(history => [history.source, ...(history.corporateActions?.source ? [history.corporateActions.source] : [])]), ...options.fx.map(row => row.source)])].sort(),
    firstObservation: null, lastObservation: null,
    cacheIdentity: await identity(options), policy,
    modelProvenance: { modelKind: "generic_portfolio_bootstrap", modelId: policy.version, reportingCurrency: options.reportingCurrency,
      returnBasis: "price_return", fxBasis: "dated_native_to_reporting_before_return", factorDataVersion: null,
      rateSource: null, benchmarkSource: null, calibrationPeriod: null, seed: policy.seed, horizon },
  };
  const empty = (): CurrencyResearchResult => ({ status: "incomplete", metadata, composition: { rows: [], total: null, complete: false }, issues, risk: null, lab: null, simulation: null });
  if (issues.length || !valid.ok) return empty();
  if (Date.parse(metadata.valuationAsOf) > Date.parse(options.asOf)) issues.push({ code: "future_valuation" });
  const historicalFx = options.fx.filter(row => options.provenance === "synthetic_fixture" ? row.kind === "synthetic" : row.kind === "daily_reference" || row.kind === "historical_spot");
  const valuationFx = [...("fx" in valid.input ? valid.input.fx ?? [] : []), ...options.fx.filter(row => options.provenance === "synthetic_fixture" ? row.kind === "synthetic" : row.kind === "spot" || row.kind === "daily_reference")];
  const rows = valid.input.rows.map((row, rowIndex): CompositionRow => {
    const value = convertMoney(row.value, row.inputCurrency ?? "KRW", options.reportingCurrency, metadata.valuationAsOf, valuationFx, policy.maxFxAgeMs);
    const instrument = QUICK_INSTRUMENTS.find(item => item.id === row.instrumentId);
    if (!value.ok) issues.push({ code: value.reason, rowIndex });
    if (!owned && !instrument && row.value > 0) issues.push({ code: "instrument_unidentified", rowIndex });
    return { name: row.name, instrumentId: row.instrumentId, nativeCurrency: owned?.rows[rowIndex].nativeCurrency ?? instrument?.currency ?? null, value: value.ok ? value.value.toNumber() : null, weight: null };
  });
  const complete = rows.every(row => row.value !== null);
  const total = complete ? rows.reduce((sum, row) => sum.add(row.value!), Decimal.from(0)).toNumber() : null;
  if (total !== null && total > 0) rows.forEach(row => { row.weight = row.value! / total; });
  else issues.push({ code: "valuation_incomplete" });
  const result: CurrencyResearchResult = { ...empty(), composition: { rows, total, complete } };
  const comparison = options.comparisonWeights ?? rows.map(row => row.weight ?? 0);
  if (comparison.length !== rows.length || comparison.some(weight => !Number.isFinite(weight) || weight < 0 || weight > 1) || Math.abs(comparison.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-8) issues.push({ code: "comparison_weights_invalid" });
  const selected = rows.map((row, index) => ({ row, index })).filter(({ row, index }) => (row.weight ?? 0) > 0 || (comparison[index] ?? 0) > 0);
  const series: number[][] = [];
  let axis: string[] | null = null;
  const ids = options.histories.map(history => history.instrumentId);
  if (new Set(ids).size !== ids.length) issues.push({ code: "duplicate_instrument_history" });
  for (const { row, index } of selected) {
    const history = options.histories.find(item => item.instrumentId === row.instrumentId);
    if (!history || !row.nativeCurrency) { issues.push({ code: "history_missing", rowIndex: index }); continue; }
    const synthetic = options.provenance === "synthetic_fixture";
    if (!history.source.trim() || (synthetic ? history.admission !== "synthetic_fixture" : !(owned ? ["shared_kis_raw", "provider_adjusted", "normalized_provider_raw", "native_cash"] : ["shared_kis_raw", "provider_adjusted"]).includes(history.admission)) ||
      history.points.some(point => point.currency !== row.nativeCurrency || (history.admission === "shared_kis_raw" && point.basis !== "raw_price") || (history.admission === "provider_adjusted" && point.basis !== "split_adjusted"))) {
      issues.push({ code: "history_admission_mismatch", rowIndex: index }); continue;
    }
    // Reject malformed axes before taking a bounded trailing window. Missing dates are never intersected away.
    if (history.points.some((point, i) => !Number.isFinite(Date.parse(point.at)) || Date.parse(point.at) > Date.parse(historyEndAt) || (i > 0 && Date.parse(point.at) <= Date.parse(history.points[i - 1].at)))) {
      issues.push({ code: "history_axis_invalid", rowIndex: index }); continue;
    }
    const points = history.points.slice(-(policy.maximumReturns + 1));
    if (points.length < policy.minimumReturns + 1) { issues.push({ code: "insufficient_history", rowIndex: index }); continue; }
    if (Date.parse(historyEndAt) - Date.parse(points.at(-1)!.at) > policy.maxHistoryAgeMs) { issues.push({ code: "history_stale", rowIndex: index }); continue; }
    const actions = history.corporateActions;
    const expectedActions = synthetic ? "synthetic_none" : ["provider_adjusted", "normalized_provider_raw"].includes(history.admission) ? "verified_split_adjusted" : "verified_no_actions";
    // Raw KIS admission establishes price identity, not absence of a stock split.
    // Never interpret an unverified 2:1 split as a -50% financial loss.
    if (!actions || actions.status !== expectedActions || !actions.source.trim() || !Number.isFinite(Date.parse(actions.from)) || !Number.isFinite(Date.parse(actions.through)) || Date.parse(actions.from) > Date.parse(points[0].at) || Date.parse(actions.through) < Date.parse(points.at(-1)!.at)) {
      issues.push({ code: "corporate_action_evidence_missing", rowIndex: index }); continue;
    }
    const converted = reportingReturnSeries(points, options.reportingCurrency, historicalFx, policy.maxFxAgeMs);
    if (!converted.ok) { issues.push({ code: converted.reason, rowIndex: index }); continue; }
    if (converted.value.some(point => !Number.isFinite(point.return) || point.return <= -1)) { issues.push({ code: "invalid_return", rowIndex: index }); continue; }
    const candidateAxis = points.map(point => point.at);
    if (axis && (axis.length !== candidateAxis.length || axis.some((at, i) => at !== candidateAxis[i]))) { issues.push({ code: "history_axis_mismatch", rowIndex: index }); continue; }
    axis = candidateAxis;
    series.push(converted.value.map(point => point.return));
  }
  if (issues.length || !axis || series.length !== selected.length) return result;
  metadata.firstObservation = axis[0]; metadata.lastObservation = axis.at(-1)!;
  const weights = selected.map(({ row }) => row.weight!);
  const alternative = selected.map(({ index }) => comparison[index]);
  const currentReturns = weightedSeries(series, weights);
  const comparisonReturns = weightedSeries(series, alternative);
  const covariance = sampleCovarianceMatrix(series);
  const selectedBases = selected.flatMap(({ row }) => options.histories.find(history => history.instrumentId === row.instrumentId)!.points.map(point => point.basis));
  const hasTotalReturn = selectedBases.includes("total_return");
  const returnBasis = hasTotalReturn ? selectedBases.every(basis => basis === "total_return") ? "total_return" : "mixed_price_and_total_return" : "price_return";
  const references = calculateCurrencyReferenceMetrics({ reportingCurrency: options.reportingCurrency, returnBasis, asOf: options.asOf,
    periods: currentReturns.map((value, index) => ({ from: axis![index], to: axis![index + 1], value })),
    annualizationFactor: policy.annualizationFactor, synthetic: options.provenance === "synthetic_fixture", benchmark: options.benchmark, riskFree: options.riskFree });
  metadata.modelProvenance.returnBasis = returnBasis;
  metadata.modelProvenance.calibrationPeriod = { from: axis[0], to: axis.at(-1)!, observations: currentReturns.length };
  metadata.modelProvenance.rateSource = references.provenance.riskFree?.source ?? null;
  metadata.modelProvenance.benchmarkSource = references.provenance.benchmark?.source ?? null;
  result.risk = { volatilityPct: Math.sqrt(sampleVariance(currentReturns) * policy.annualizationFactor) * 100, correlation: correlationMatrixFromCovariance(covariance, standardDeviations(covariance)), observations: currentReturns.length,
    ...references };
  if (options.calculation === "risk_only") { result.status = "ready"; return result; }
  let current = 100, compared = 100;
  const points: LabPoint[] = [{ at: axis[0], current, comparison: compared }];
  currentReturns.forEach((value, i) => { current *= 1 + value; compared *= 1 + comparisonReturns[i]; points.push({ at: axis![i + 1], current, comparison: compared }); });
  result.lab = { points, currentReturnPct: current - 100, comparisonReturnPct: compared - 100, weights: [...comparison] };
  // New explicit amount-only policy. Do not forge a legacy admitted KRW matrix to reuse its executor.
  // One sampled date row is shared by every holding; contiguous blocks retain some temporal dependence.
  const random = createMulberry32(policy.seed);
  const paths: number[][] = [];
  for (let pathIndex = 0; pathIndex < policy.pathCount; pathIndex++) {
    const path = [1];
    let source = Math.floor(random() * currentReturns.length);
    for (let step = 0; step < horizon; step++) {
      if (step > 0) source = random() < 1 / policy.expectedBlockLength ? Math.floor(random() * currentReturns.length) : (source + 1) % currentReturns.length;
      path.push(path.at(-1)! * (1 + currentReturns[source]));
    }
    paths.push(path);
  }
  const summary = summarizeSimulationNavPaths({ paths, horizon, samplePathCount: 30 });
  if (summary.status !== "ready" || points.some(point => !Number.isFinite(point.current) || !Number.isFinite(point.comparison))) {
    issues.push({ code: "path_calculation_invalid" }); result.lab = null; return result;
  }
  result.simulation = { pathCount: policy.pathCount, horizon, paths, summary };
  result.status = "ready";
  return result;
}

async function identity(input: CurrencyResearchInput) {
  // Private in-memory identity only. Never put this payload or its key in analytics, logs or URLs.
  const payload = JSON.stringify({ policy: CURRENCY_RESEARCH_POLICY, ...input });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return `sha256:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("")}`;
}
