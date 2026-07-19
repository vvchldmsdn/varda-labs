import {
  createInvestmentLabContributionScenarioEvidence,
  type InvestmentLabContributionScenarioEvidence,
  type InvestmentLabContributionScenarioPoint,
} from "./investment-lab-contribution-experiment.ts";
import type { InvestmentLabVooComparison } from "./investment-lab-voo-comparison.ts";
import type { InvestmentLabVooValuationEvidence } from "./investment-lab-voo-evidence.ts";

type KodexScenarioRow = Readonly<{
  serviceDate: string;
  valuationPriceDate: string;
  adjustedClose: number;
  investedMarketValueKrw: number;
}>;

export function buildInvestmentLabContributionScenarioEvidence(input: {
  kodexRows: readonly KodexScenarioRow[];
  vooComparison: InvestmentLabVooComparison;
  vooValuations: readonly InvestmentLabVooValuationEvidence[];
}): readonly InvestmentLabContributionScenarioEvidence[] {
  const scenarios: InvestmentLabContributionScenarioEvidence[] = [];
  const kodex = createInvestmentLabContributionScenarioEvidence({
    scenarioId: "kodex200",
    priceBasis: "adjusted_close_krw",
    points: input.kodexRows.map((row) => ({
      serviceDate: row.serviceDate,
      valuationPriceDate: row.valuationPriceDate,
      unitValueKrw: row.adjustedClose,
      baseScenarioValueKrw: row.investedMarketValueKrw,
    })),
  });
  if (kodex) scenarios.push(kodex);
  const voo = buildVooScenario(input.vooComparison, input.vooValuations);
  if (voo) scenarios.push(voo);

  return Object.freeze(scenarios);
}

function buildVooScenario(
  comparison: InvestmentLabVooComparison,
  valuations: readonly InvestmentLabVooValuationEvidence[],
) {
  if (
    comparison.status !== "ready" ||
    comparison.rows.length !== valuations.length
  ) {
    return null;
  }

  const valuationByDate = new Map<string, InvestmentLabVooValuationEvidence>();
  for (const valuation of valuations) {
    if (valuationByDate.has(valuation.serviceDate)) return null;
    valuationByDate.set(valuation.serviceDate, valuation);
  }

  const points: InvestmentLabContributionScenarioPoint[] = [];
  for (const row of comparison.rows) {
    const valuation = valuationByDate.get(row.serviceDate);
    if (!valuation || valuation.priceDate !== row.valuationPriceDate) {
      return null;
    }
    points.push({
      serviceDate: row.serviceDate,
      valuationPriceDate: valuation.priceDate,
      unitValueKrw: valuation.unitValueKrw,
      baseScenarioValueKrw: row.scenarioMarketValueKrw,
    });
  }

  return createInvestmentLabContributionScenarioEvidence({
    scenarioId: "voo",
    priceBasis: "raw_close_usd_times_stored_snapshot_fx",
    points,
  });
}
