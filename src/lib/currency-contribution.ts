import { calculateExplainableAdditionalContribution, type AdditionalContributionPolicyRow } from "./additional-contribution-policy-engine.ts";
import { convertMoney, costInReportingCurrency, costLotsInReportingCurrency, type FxEvidence } from "./currency-valuation.ts";
import type { NativeCostLot } from "./native-portfolio-ledger.ts";
import { Decimal, MINOR_DIGITS, moneyFromMinor, type Currency } from "./money.ts";

export const CURRENCY_CONTRIBUTION_VERSION = "explainable_contribution_currency_v1";
export type ContributionMoneyEvidence = { amount: string; currency: Currency; at: string; source: string; kind?: "new_money" | "native_cash"; accountId?: string };
type MoneyEvidence = ContributionMoneyEvidence;
export type CurrencyContributionInput = {
  reportingCurrency: Currency; asOf: string; fx: readonly FxEvidence[]; maxFxAgeMs: number;
  funds: readonly MoneyEvidence[]; trimDriftThresholdPct: number; minimumExecutionRatioPct: number;
  rows: (Omit<AdditionalContributionPolicyRow<unknown>, "currentValueKrw" | "costBasisKrw" | "hasExactLoss"> & {
    value: MoneyEvidence; cost: MoneyEvidence | null; costLots?: readonly NativeCostLot[] | null;
    maBasis?: { priceCurrency: Currency; averageCurrency: Currency; priceBasis: string; averageBasis: string };
  })[];
};

/** Adapt existing policy to minimum currency units. No new allocation or MA policy. */
export function calculateCurrencyContribution(input: CurrencyContributionInput) {
  try {
    return calculateCurrencyContributionChecked(input);
  } catch (error) {
    return { status: "blocked" as const, reason: error instanceof Error && ["money_overflow", "decimal_overflow"].includes(error.message) ? "money_overflow" : "invalid_decimal_evidence" };
  }
}

function calculateCurrencyContributionChecked(input: CurrencyContributionInput) {
  const scale = 10 ** MINOR_DIGITS[input.reportingCurrency];
  if (!Number.isFinite(scale) || !Number.isFinite(Date.parse(input.asOf)) || !Number.isFinite(input.maxFxAgeMs) || input.maxFxAgeMs < 0 || input.funds.length === 0) return { status: "blocked" as const, reason: "invalid_context" };
  let funds = Decimal.from(0);
  for (const fund of input.funds) {
    if (!fund.source || !Number.isFinite(Date.parse(fund.at)) || Date.parse(fund.at) > Date.parse(input.asOf)) return { status: "blocked" as const, reason: "invalid_fund_evidence" };
    const converted = convertMoney(fund.amount, fund.currency, input.reportingCurrency, input.asOf, input.fx, input.maxFxAgeMs);
    if (!converted.ok) return { status: "blocked" as const, reason: converted.reason };
    if (converted.value.compare(0) < 0) return { status: "blocked" as const, reason: "invalid_funds" };
    funds = funds.add(converted.value);
  }
  const units = funds.minor(input.reportingCurrency, "floor");
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) return { status: "blocked" as const, reason: "money_overflow" };
  const rows: AdditionalContributionPolicyRow<unknown>[] = [];
  for (const row of input.rows) {
    if (!row.value.source || row.value.at !== input.asOf) return { status: "blocked" as const, reason: "valuation_time_mismatch" };
    const value = convertMoney(row.value.amount, row.value.currency, input.reportingCurrency, input.asOf, input.fx, input.maxFxAgeMs);
    if (!value.ok) return { status: "blocked" as const, reason: value.reason };
    const scaledValue = value.value.mul(scale);
    if (scaledValue.compare(0) < 0 || scaledValue.compare(Number.MAX_SAFE_INTEGER) > 0) return { status: "blocked" as const, reason: "money_overflow" };
    const cost = row.costLots !== undefined ? costLotsInReportingCurrency(row.costLots, input.reportingCurrency, input.fx, input.maxFxAgeMs, input.asOf) : row.cost && Date.parse(row.cost.at) <= Date.parse(input.asOf)
      ? costInReportingCurrency(row.cost, input.reportingCurrency, input.fx, input.maxFxAgeMs) : null;
    if (cost?.ok && (cost.value.compare(0) < 0 || cost.value.mul(scale).compare(Number.MAX_SAFE_INTEGER) > 0)) return { status: "blocked" as const, reason: "invalid_cost_basis" };
    const validMa = row.maBasis && row.maBasis.priceCurrency === row.maBasis.averageCurrency && row.maBasis.priceBasis === row.maBasis.averageBasis;
    rows.push({ ...row, currentValueKrw: scaledValue.toNumber(), costBasisKrw: cost?.ok ? cost.value.mul(scale).toNumber() : null,
      hasExactLoss: cost?.ok ? value.value.compare(cost.value) < 0 : false,
      ma120Evidence: validMa ? row.ma120Evidence : { status: "unavailable", distanceFromMaPct: null } });
  }
  const result = calculateExplainableAdditionalContribution({ rows, cashAmountKrw: Number(units), trimDriftThresholdPct: input.trimDriftThresholdPct, minimumExecutionRatioPct: input.minimumExecutionRatioPct });
  if (result.status !== "ready") return { status: "blocked" as const, reason: result.blockers.join(",") };
  const amount = (n: number) => moneyFromMinor(n, input.reportingCurrency);
  return {
    status: "ready" as const,
    context: { version: CURRENCY_CONTRIBUTION_VERSION, policyVersion: result.policy.version, reportingCurrency: input.reportingCurrency,
      profitCurrency: input.reportingCurrency, asOf: input.asOf, fx: input.fx, originalFunds: input.funds,
      originalCosts: input.rows.map(row => ({ key: row.allocationKey, cost: row.cost, ...(row.costLots !== undefined ? { costLots: row.costLots } : {}) })),
      plannedSaleProceeds: result.rows.filter(row => row.trimAmountKrw > 0).map(row => {
        const original = input.rows.find(item => item.allocationKey === row.allocationKey)!;
        const native = convertMoney(String(amount(row.trimAmountKrw)), input.reportingCurrency, original.value.currency, input.asOf, input.fx, input.maxFxAgeMs);
        return { key: row.allocationKey, amount: native.ok ? String(moneyFromMinor(native.value.minor(original.value.currency, "floor"), original.value.currency)) : null,
          exactAmount: native.ok ? { n: native.value.n.toString(), d: native.value.d.toString() } : null,
          currency: original.value.currency, at: input.asOf, source: "hypothetical_rebalance_sale", rounding: "floor_native_minor_unit", reportingAmount: amount(row.trimAmountKrw) };
      }),
      conversion: "reference_conversion_without_spread_or_fees" as const, orders: "none" as const },
    available: amount(result.totalAvailableFundsKrw), buys: amount(result.totalAllocatedKrw), sales: amount(result.totalTrimProceedsKrw),
    remainingCash: amount(result.residualCashKrw), costs: 0,
    conversionRemainder: funds.sub(moneyFromMinor(units, input.reportingCurrency)).toNumber(),
    rows: result.rows.map(row => ({ key: row.allocationKey, buy: amount(row.allocationKrw), sell: amount(row.trimAmountKrw),
      beforePct: row.currentWeightPct, afterPct: row.postTradeWeightPct, targetPct: row.targetWeightBps / 100,
      trimReason: row.trimReason, maMultiplier: row.maEffectiveMultiplier, maReason: row.maAdjustmentReason, profitPct: row.unrealizedReturnPct })),
  };
}
