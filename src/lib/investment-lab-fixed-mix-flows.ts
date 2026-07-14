import type { InvestmentLabReturnFlow } from "./investment-lab-modified-dietz.ts";
import type {
  InvestmentLabFixedMixComponentFlow,
  InvestmentLabFixedMixWeights,
} from "./investment-lab-fixed-mix-types.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";

export function resolveInvestmentLabFixedMixFlows(
  kodexRows: readonly InvestmentLabFixedMixComponentFlow[],
  vooRows: readonly InvestmentLabFixedMixComponentFlow[],
  weights: InvestmentLabFixedMixWeights,
) {
  const kodex = indexFlows(kodexRows);
  const voo = indexFlows(vooRows);
  if (!kodex || !voo || kodex.size !== voo.size) return null;

  const sourceIndexes = [...kodex.keys()].sort((left, right) => left - right);
  const scenarioFlows: InvestmentLabReturnFlow[] = [];
  let splitExecutionDateRows = 0;
  for (const sourceIndex of sourceIndexes) {
    const kodexFlow = kodex.get(sourceIndex)!;
    const vooFlow = voo.get(sourceIndex);
    if (
      !vooFlow ||
      kodexFlow.direction !== vooFlow.direction ||
      !nearlyEqual(kodexFlow.amountKrw, vooFlow.amountKrw)
    ) {
      return null;
    }
    if (kodexFlow.executionServiceDate !== vooFlow.executionServiceDate) {
      splitExecutionDateRows += 1;
    }
    scenarioFlows.push(
      Object.freeze({
        effectiveServiceDate: kodexFlow.executionServiceDate,
        sequence: sourceIndex * 2,
        direction: kodexFlow.direction,
        amountKrw: (kodexFlow.amountKrw * weights.kodexWeightBps) / 10_000,
      }),
      Object.freeze({
        effectiveServiceDate: vooFlow.executionServiceDate,
        sequence: sourceIndex * 2 + 1,
        direction: vooFlow.direction,
        amountKrw: (vooFlow.amountKrw * weights.vooWeightBps) / 10_000,
      }),
    );
  }

  return Object.freeze({
    sourceCount: sourceIndexes.length,
    splitExecutionDateRows,
    scenarioFlows: Object.freeze(scenarioFlows),
  });
}

function indexFlows(rows: readonly InvestmentLabFixedMixComponentFlow[]) {
  const bySource = new Map<number, InvestmentLabFixedMixComponentFlow>();
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.sourceIndex) ||
      row.sourceIndex < 0 ||
      row.sourceIndex > (Number.MAX_SAFE_INTEGER - 1) / 2 ||
      !isRiskDate(row.executionServiceDate) ||
      (row.direction !== "inflow" && row.direction !== "outflow") ||
      !positiveFinite(row.amountKrw) ||
      bySource.has(row.sourceIndex)
    ) {
      return null;
    }
    bySource.set(row.sourceIndex, row);
  }
  return bySource;
}

function positiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function nearlyEqual(left: number, right: number) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <=
      1e-8 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}
