import { allocateBasisPointsByValue } from "./basis-point-allocation.ts";
import { buildTrackedCurrencyPortfolio, type TrackedPortfolioEvidence } from "./currency-tracked-portfolio.ts";
import { Decimal } from "./money.ts";

/** Admit the existing KRW security-only model only when it describes exactly
 * the same owner portfolio. No proxy rates, omitted cash or currency relabeling. */
export function admitNativeKrwEconomic(evidence: TrackedPortfolioEvidence, research: {
  inputPreflight: { instruments: readonly { instrumentKey: string; currentValueKrw: number; weightBps: number | null }[] };
  execution: { executionWeights: readonly { instrumentKey: string; weightBps: number }[] };
}) {
  const blocked = (reason: string) => ({ ready: false as const, reason });
  if (evidence.reporting !== "KRW") return blocked("usd_economic_policy_unvalidated");
  const value = buildTrackedCurrencyPortfolio(evidence);
  if (!evidence.ledgerComplete || !value.current?.complete) return blocked("native_valuation_incomplete");
  const aggregated = new Map<string, Decimal>();
  for (const position of evidence.current.positions) {
    if (position.kind === "cash") {
      if (!position.observation || Decimal.from(position.observation.quantity).compare(0) !== 0) return blocked("native_cash_component_not_supported");
      continue;
    }
    const valued = value.current.positions.find(row => row.id === position.id);
    if (!position.ticker || !position.market || !position.observation || valued?.value == null) return blocked("native_portfolio_input_mismatch");
    if (Decimal.from(valued.value).compare(0) === 0) continue;
    const key = `${position.market.toLowerCase()}:${position.observation.currency}:${position.ticker.toUpperCase()}`;
    aggregated.set(key, (aggregated.get(key) ?? Decimal.from(0)).add(valued.value));
  }
  if (!aggregated.size || research.inputPreflight.instruments.length !== aggregated.size || research.execution.executionWeights.length !== aggregated.size) return blocked("native_portfolio_input_mismatch");
  const weights = allocateBasisPointsByValue([...aggregated].map(([key, amount]) => ({ key, value: amount.toNumber() })));
  if (!weights) return blocked("native_portfolio_input_mismatch");
  const seen = new Set<string>();
  for (const row of research.inputPreflight.instruments) {
    const amount = aggregated.get(row.instrumentKey);
    if (!amount || seen.has(row.instrumentKey) || !Number.isFinite(row.currentValueKrw) || amount.compare(row.currentValueKrw) !== 0 || weights.get(row.instrumentKey) !== row.weightBps) return blocked("native_portfolio_input_mismatch");
    seen.add(row.instrumentKey);
  }
  const executionKeys = new Set<string>();
  for (const row of research.execution.executionWeights) {
    if (executionKeys.has(row.instrumentKey) || weights.get(row.instrumentKey) !== row.weightBps) return blocked("native_portfolio_input_mismatch");
    executionKeys.add(row.instrumentKey);
  }
  return { ready: true as const, reason: null };
}
