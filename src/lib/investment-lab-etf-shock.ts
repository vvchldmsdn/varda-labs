import type { InvestmentLabEtfXrayComponentRow } from "./investment-lab-etf-xray-types.ts";

export const INVESTMENT_LAB_ETF_SHOCK_POLICY = Object.freeze({
  version: "static_single_name_linear_shock_v1",
  exposureBasis: "direct_plus_observed_etf_lookthrough_no_renormalization",
  persistence: "none_client_memory_only",
  minimumShockPct: -100,
  maximumShockPct: 100,
});

export type InvestmentLabEtfShockBlocker =
  | "invalid_component_evidence"
  | "invalid_valued_subset"
  | "invalid_shock_percentage"
  | "invalid_exposure_total"
  | "invalid_calculation_result";

export type InvestmentLabEtfShockResult =
  | Readonly<{
      status: "ready";
      policyVersion: typeof INVESTMENT_LAB_ETF_SHOCK_POLICY.version;
      componentKey: string;
      name: string;
      symbol: string;
      market: string;
      currency: string;
      shockPct: number;
      valuedSubsetCurrentValueKrw: number;
      etfThroughExposurePct: number;
      directExposurePct: number;
      coveredExposurePct: number;
      estimatedValuedSubsetChangePercentagePoints: number;
      estimatedChangeKrw: number;
      estimatedPostShockValueKrw: number;
      throughEtfs: readonly string[];
      asOfDates: readonly string[];
      mixedAsOfDates: boolean;
    }>
  | Readonly<{
      status: "blocked";
      policyVersion: typeof INVESTMENT_LAB_ETF_SHOCK_POLICY.version;
      blockers: readonly InvestmentLabEtfShockBlocker[];
    }>;

const EXPOSURE_EPSILON = 0.000001;
const SERVICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function calculateInvestmentLabEtfShock(input: {
  component: InvestmentLabEtfXrayComponentRow;
  valuedSubsetCurrentValueKrw: number;
  shockPct: number;
}): InvestmentLabEtfShockResult {
  const blockers: InvestmentLabEtfShockBlocker[] = [];
  if (!isValidComponent(input.component)) {
    blockers.push("invalid_component_evidence");
  }
  if (!isSafeCurrencyValue(input.valuedSubsetCurrentValueKrw)) {
    blockers.push("invalid_valued_subset");
  }
  if (
    !Number.isFinite(input.shockPct) ||
    input.shockPct < INVESTMENT_LAB_ETF_SHOCK_POLICY.minimumShockPct ||
    input.shockPct > INVESTMENT_LAB_ETF_SHOCK_POLICY.maximumShockPct
  ) {
    blockers.push("invalid_shock_percentage");
  }

  const etfThroughExposurePct = input.component.valuedSubsetExposurePct;
  const directExposurePct = input.component.directValuedSubsetWeightPct;
  const coveredExposurePct = etfThroughExposurePct + directExposurePct;
  if (
    !Number.isFinite(coveredExposurePct) ||
    coveredExposurePct < 0 ||
    coveredExposurePct > 100 + EXPOSURE_EPSILON
  ) {
    blockers.push("invalid_exposure_total");
  }
  if (blockers.length > 0) return blocked(blockers);

  const estimatedValuedSubsetChangePercentagePoints =
    (coveredExposurePct * input.shockPct) / 100;
  const estimatedChangeKrw =
    (input.valuedSubsetCurrentValueKrw *
      estimatedValuedSubsetChangePercentagePoints) /
    100;
  const estimatedPostShockValueKrw =
    input.valuedSubsetCurrentValueKrw + estimatedChangeKrw;
  if (
    !isSafeSignedCurrencyValue(estimatedChangeKrw) ||
    !isSafeCurrencyValue(estimatedPostShockValueKrw) ||
    !Number.isFinite(estimatedValuedSubsetChangePercentagePoints)
  ) {
    return blocked(["invalid_calculation_result"]);
  }

  return Object.freeze({
    status: "ready",
    policyVersion: INVESTMENT_LAB_ETF_SHOCK_POLICY.version,
    componentKey: investmentLabEtfShockComponentKey(input.component),
    name: input.component.name,
    symbol: input.component.symbol,
    market: input.component.market,
    currency: input.component.currency,
    shockPct: input.shockPct,
    valuedSubsetCurrentValueKrw: input.valuedSubsetCurrentValueKrw,
    etfThroughExposurePct,
    directExposurePct,
    coveredExposurePct,
    estimatedValuedSubsetChangePercentagePoints,
    estimatedChangeKrw,
    estimatedPostShockValueKrw,
    throughEtfs: Object.freeze([...input.component.throughEtfs]),
    asOfDates: Object.freeze([...input.component.asOfDates]),
    mixedAsOfDates: input.component.asOfDates.length > 1,
  });
}

export function investmentLabEtfShockComponentKey(
  component: Pick<
    InvestmentLabEtfXrayComponentRow,
    "market" | "currency" | "symbol"
  >,
) {
  return JSON.stringify([component.market, component.currency, component.symbol]);
}

function isValidComponent(component: InvestmentLabEtfXrayComponentRow) {
  return (
    hasText(component.name) &&
    hasText(component.symbol) &&
    hasText(component.market) &&
    hasText(component.currency) &&
    isExposure(component.valuedSubsetExposurePct) &&
    isExposure(component.directValuedSubsetWeightPct) &&
    component.throughEtfs.length > 0 &&
    component.throughEtfs.every(hasText) &&
    component.asOfDates.length > 0 &&
    component.asOfDates.every((value) => SERVICE_DATE_PATTERN.test(value))
  );
}

function isExposure(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function isSafeCurrencyValue(value: number) {
  return (
    Number.isFinite(value) &&
    value > 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function isSafeSignedCurrencyValue(value: number) {
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function hasText(value: string) {
  return value.trim().length > 0;
}

function blocked(
  blockers: readonly InvestmentLabEtfShockBlocker[],
): InvestmentLabEtfShockResult {
  return Object.freeze({
    status: "blocked",
    policyVersion: INVESTMENT_LAB_ETF_SHOCK_POLICY.version,
    blockers: Object.freeze([...new Set(blockers)]),
  });
}
