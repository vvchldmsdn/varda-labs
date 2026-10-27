import { annualizedSharpe, sampleCovarianceMatrix, sampleVariance, ZERO_VARIANCE_EPSILON } from "./portfolio-risk-statistics.ts";
import { isCurrency, type Currency } from "./money.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";

export const CURRENCY_REFERENCE_POLICY = Object.freeze({
  version: "currency_reference_exact_intervals_v1",
  calendar: "exact_observed_interval_endpoints",
  benchmarkFx: "native_reporting_currency_only_no_conversion",
  riskFreeDefinition: "realized_cash_holding_period_return",
  riskFreeConversion: "provider_interval_return_no_yield_conversion",
  missing: "unavailable_metric_preserve_portfolio_research",
} as const);

export type CurrencyReturnBasis = "price_return" | "total_return";
export type ReferenceSource = Readonly<{ provider: string; dataset: string; version: string }>;
export type ReferencePeriod = Readonly<{
  from: string; to: string; value: number;
  /** Actual source observation/publication/import times, not service-date aliases. */
  observedAt: string; publishedAt: string; fetchedAt: string;
}>;
type ReferenceEvidence = Readonly<{
  version: typeof CURRENCY_REFERENCE_POLICY.version;
  admission: "reviewed_provider_series" | "synthetic_fixture";
  currency: Currency; source: ReferenceSource;
  calendar: typeof CURRENCY_REFERENCE_POLICY.calendar;
  periods: readonly ReferencePeriod[];
}>;
export type CurrencyBenchmarkEvidence = ReferenceEvidence & Readonly<{
  identity: Readonly<{ id: string; name: string; market: string; symbol: string; currency: Currency }>;
  returnBasis: CurrencyReturnBasis;
  fxBasis: typeof CURRENCY_REFERENCE_POLICY.benchmarkFx;
}>;
export type CurrencyRiskFreeEvidence = ReferenceEvidence & Readonly<{
  identity: string; maturity: string; definition: typeof CURRENCY_REFERENCE_POLICY.riskFreeDefinition;
  conversion: typeof CURRENCY_REFERENCE_POLICY.riskFreeConversion;
}>;
export type CurrencyReferenceInput = Readonly<{
  reportingCurrency: Currency; returnBasis: CurrencyReturnBasis | "mixed_price_and_total_return"; asOf: string;
  periods: readonly Readonly<{ from: string; to: string; value: number }>[];
  annualizationFactor: number; synthetic: boolean;
  benchmark?: CurrencyBenchmarkEvidence | null;
  riskFree?: CurrencyRiskFreeEvidence | null;
}>;

/** Evidence affects only its metric. It never repairs portfolio coverage, converts
 * a foreign benchmark, intersects dates, or treats an annual yield as a daily return. */
export function calculateCurrencyReferenceMetrics(input: CurrencyReferenceInput) {
  const contextValid = isCurrency(input.reportingCurrency) && ["price_return", "total_return"].includes(input.returnBasis) && timestamp(input.asOf) && input.periods.length >= 2 &&
    Number.isFinite(input.annualizationFactor) && input.annualizationFactor > 0 && input.periods.every((row, i) =>
      timestamp(row.from) && timestamp(row.to) && Date.parse(row.from) < Date.parse(row.to) && Date.parse(row.to) <= Date.parse(input.asOf) &&
      Number.isFinite(row.value) && row.value > -1 && (i === 0 || row.from === input.periods[i - 1].to));
  const check = (evidence: ReferenceEvidence | null | undefined, kind: "benchmark" | "risk_free") => {
    if (!evidence) return kind === "benchmark" ? "matched_benchmark_not_supplied" : "risk_free_evidence_not_supplied";
    if (!contextValid) return "reference_portfolio_context_invalid";
    if (evidence.version !== CURRENCY_REFERENCE_POLICY.version || !text(evidence.source?.provider) || !text(evidence.source?.dataset) || !text(evidence.source?.version) ||
      evidence.admission !== (input.synthetic ? "synthetic_fixture" : "reviewed_provider_series")) return `${kind}_provenance_invalid`;
    if (evidence.currency !== input.reportingCurrency) return `${kind}_currency_mismatch`;
    if (evidence.calendar !== CURRENCY_REFERENCE_POLICY.calendar || !Array.isArray(evidence.periods) || evidence.periods.length !== input.periods.length || evidence.periods.some((row, i) => !row || row.from !== input.periods[i].from || row.to !== input.periods[i].to)) return `${kind}_calendar_mismatch`;
    if (evidence.periods.some(row => !Number.isFinite(row.value) || row.value <= -1 || !timestamp(row.observedAt) || !timestamp(row.publishedAt) || !timestamp(row.fetchedAt) ||
      Date.parse(row.observedAt) > Date.parse(row.to) || Date.parse(row.observedAt) < Date.parse(row.from) || Date.parse(row.publishedAt) < Date.parse(row.observedAt) ||
      Date.parse(row.fetchedAt) < Date.parse(row.publishedAt) || Date.parse(row.fetchedAt) > Date.parse(input.asOf))) return `${kind}_observation_invalid`;
    return null;
  };
  let benchmarkReason = check(input.benchmark, "benchmark");
  let riskFreeReason = check(input.riskFree, "risk_free");
  const benchmark = input.benchmark;
  const riskFree = input.riskFree;
  if (!benchmarkReason && benchmark && (!text(benchmark.identity?.id) || !text(benchmark.identity?.name) || !text(benchmark.identity?.market) || !text(benchmark.identity?.symbol) || benchmark.identity.currency !== input.reportingCurrency)) benchmarkReason = "benchmark_identity_invalid";
  if (!benchmarkReason && benchmark && (benchmark.returnBasis !== input.returnBasis || benchmark.fxBasis !== CURRENCY_REFERENCE_POLICY.benchmarkFx)) benchmarkReason = "benchmark_return_basis_mismatch";
  if (!riskFreeReason && riskFree && (!text(riskFree.identity) || !text(riskFree.maturity) || riskFree.definition !== CURRENCY_REFERENCE_POLICY.riskFreeDefinition || riskFree.conversion !== CURRENCY_REFERENCE_POLICY.riskFreeConversion)) riskFreeReason = "risk_free_definition_invalid";
  let sharpe: number | null = null, beta: number | null = null;
  let comparison: { portfolioReturnPct: number; benchmarkReturnPct: number; differencePp: number } | null = null;
  const returns = input.periods.map(row => row.value);
  if (!riskFreeReason && riskFree) {
    const excess = returns.map((value, i) => value - riskFree.periods[i].value);
    // Zero here is an algebraic offset after subtracting every observed cash
    // return; it is never an assumed risk-free rate for the portfolio.
    const metric = annualizedSharpe({ returns: excess, dailyRiskFreeRate: 0, annualizationFactor: input.annualizationFactor });
    sharpe = metric.value; if (metric.reason) riskFreeReason = `risk_free_${metric.reason}`;
  }
  if (!benchmarkReason && benchmark) {
    const values = benchmark.periods.map(row => row.value), variance = sampleVariance(values);
    if (variance > ZERO_VARIANCE_EPSILON) beta = sampleCovarianceMatrix([returns, values])[0][1] / variance;
    else benchmarkReason = "zero_benchmark_variance";
    const portfolioReturnPct = (returns.reduce((nav, value) => nav * (1 + value), 1) - 1) * 100;
    const benchmarkReturnPct = (values.reduce((nav, value) => nav * (1 + value), 1) - 1) * 100;
    if (Number.isFinite(portfolioReturnPct) && Number.isFinite(benchmarkReturnPct)) comparison = { portfolioReturnPct, benchmarkReturnPct, differencePp: portfolioReturnPct - benchmarkReturnPct };
    else { benchmarkReason = "benchmark_path_nonfinite"; beta = null; }
  }
  return { sharpe, beta, comparison, reasons: [riskFreeReason, benchmarkReason].filter((reason): reason is string => reason !== null),
    provenance: { policyId: CURRENCY_REFERENCE_POLICY.version, reportingCurrency: input.reportingCurrency, returnBasis: input.returnBasis,
      calendar: CURRENCY_REFERENCE_POLICY.calendar, firstObservation: input.periods[0]?.from ?? null, lastObservation: input.periods.at(-1)?.to ?? null,
      benchmark: benchmark && (!benchmarkReason || benchmarkReason === "zero_benchmark_variance") ? { identity: benchmark.identity, source: benchmark.source, currency: benchmark.currency, returnBasis: benchmark.returnBasis, fxBasis: benchmark.fxBasis, observationCount: benchmark.periods.length, observations: benchmark.periods } : null,
      riskFree: riskFree && (!riskFreeReason || riskFreeReason === "risk_free_zero_variance") ? { identity: riskFree.identity, source: riskFree.source, currency: riskFree.currency, maturity: riskFree.maturity, definition: riskFree.definition, conversion: riskFree.conversion, observationCount: riskFree.periods.length, observations: riskFree.periods } : null,
    },
  };
}

function timestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && isRiskDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number.isFinite(Date.parse(value)); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
