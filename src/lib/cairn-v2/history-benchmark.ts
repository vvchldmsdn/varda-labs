import type { loadInvestmentLabCounterfactualReadModel } from "../investment-lab-counterfactual-read-loader.ts";
import type { InvestmentLabAnalysisScopeEvidence } from "../investment-lab-analysis-scope.ts";
import { labTradePeriod } from "../investment-lab-native-period.ts";
import type { PeriodAttributionRange } from "./period-attribution.ts";

export type BenchmarkChoice = "mix" | "kodex" | "voo";
export type BenchmarkIssue = "period" | "valuation" | "trade" | "price" | "fx" | "execution";
export type BenchmarkPoint = { date: string; actual: number; hypothetical: number; difference: number; pending: boolean };
export type BenchmarkScenario = { choice: BenchmarkChoice; state: "ready" | "unavailable"; points: BenchmarkPoint[]; issues: BenchmarkIssue[] };
export type HistoryBenchmarkRead = {
  range: PeriodAttributionRange;
  currency: "KRW";
  policy: "same_starting_value_and_trade_amounts";
  scenarios: BenchmarkScenario[];
  suggestedRange: PeriodAttributionRange | null;
  trades: { date: string; label: string | null; reason: string }[];
  excludedFount: boolean;
  accountCount: number;
};
type Source = Pick<Awaited<ReturnType<typeof loadInvestmentLabCounterfactualReadModel>>, "model" | "period" | "observedHistory" | "fountScopeAdjustment">;
type Row = { serviceDate: string; actualMarketValueKrw: number; scenarioMarketValueKrw: number; differenceKrw: number; hasPendingExecution: boolean };

const sharedBlockers = new Set(["snapshot_evidence_invalid", "source_segment_authority_blocked", "fount_scope_adjustment_blocked",
  "actual_path_reconciliation_mismatch", "actual_path_incomplete", "event_account_unresolved", "event_evidence_unsupported",
  "account_composition_incomplete", "account_composition_mismatch"]);
function issuesFor(codes: readonly string[]): BenchmarkIssue[] {
  return [...new Set(codes.map((code): BenchmarkIssue => /fx/.test(code) ? "fx" :
    /pending|schedule|execution/.test(code) ? "execution" : /event|flow/.test(code) ? "trade" :
    /close|price|component_path/.test(code) ? "price" : "valuation"))];
}

/** A projection of the existing research engine, never a new price/flow calculation. */
export function buildHistoryBenchmark(source: Source, evidence: InvestmentLabAnalysisScopeEvidence, range: PeriodAttributionRange): HistoryBenchmarkRead {
  const { model, period } = source;
  const trades = labTradePeriod(period, source.observedHistory.segments, evidence.nativeTradeEvidence);
  const globalIssues: BenchmarkIssue[] = [];
  if (period.status !== "selected" || period.selectedStartServiceDate !== range.start || period.selectedEndServiceDate !== range.end) globalIssues.push("period");
  if (model.blockers.some(code => sharedBlockers.has(code))) globalIssues.push("valuation");
  if (trades?.blocked.length) globalIssues.push("trade");
  function scenario(choice: BenchmarkChoice, ready: boolean, rows: readonly Row[], codes: readonly string[]): BenchmarkScenario {
    const issues = [...globalIssues];
    if (!ready) issues.push(...issuesFor(codes.length ? codes : ["component_path_unavailable"]));
    // Never silently show a different range or leak a ready component when shared evidence failed.
    if (ready && (rows[0]?.serviceDate !== range.start || rows.at(-1)?.serviceDate !== range.end || rows.some(row =>
      ![row.actualMarketValueKrw, row.scenarioMarketValueKrw, row.differenceKrw].every(Number.isFinite)))) issues.push("valuation");
    return { choice, state: issues.length ? "unavailable" : "ready", issues: [...new Set(issues)],
      points: issues.length ? [] : rows.map(row => ({ date: row.serviceDate, actual: row.actualMarketValueKrw,
        hypothetical: row.scenarioMarketValueKrw, difference: row.differenceKrw, pending: row.hasPendingExecution })) };
  }
  const voo = model.vooComparison;
  const mix = model.fixedMixComparison?.scenarios.find(row => row.kodexWeightPct === 50)?.scenario;
  const scenarios = [scenario("mix", mix?.status === "ready", mix?.rows ?? [], mix?.blockers ?? []),
    scenario("kodex", model.status === "ready", model.rows, model.blockers),
    scenario("voo", voo?.status === "ready", voo?.rows ?? [], voo?.blockers ?? [])];
  let suggestedRange = trades?.candidate ?? null;
  if (!suggestedRange && globalIssues.includes("period")) {
    const tradeDates = new Set(evidence.nativeTradeEvidence?.valued.map(row => row.date));
    const blocked = evidence.nativeTradeEvidence?.blocked ?? [];
    // Suggest only one observed current-writer segment inside the requested dates. The user opts in;
    // the same engine still checks the suggested range on the next request.
    for (const segment of [...source.observedHistory.segments].reverse()) {
      if (segment.role !== "current_writer") continue;
      const dates = segment.rows.map(row => row.serviceDate).filter(date => date >= range.start && date <= range.end);
      const start = dates.find(date => !tradeDates.has(date)), end = dates.at(-1);
      if (start && end && start < end && !blocked.some(row => row.date >= start && row.date <= end)) { suggestedRange = { start, end }; break; }
    }
  }
  return { range, currency: "KRW", policy: "same_starting_value_and_trade_amounts", scenarios,
    suggestedRange: suggestedRange?.start === range.start && suggestedRange.end === range.end ? null : suggestedRange,
    trades: trades?.blocked ?? [], accountCount: evidence.includedAccountCodes.length,
    excludedFount: source.fountScopeAdjustment.status === "applied" || evidence.fountAdjustment.status === "applied" };
}
