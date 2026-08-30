import { buildPortfolioStructureDesignPreview } from "./portfolio-structure-design-preview.ts";
import { buildSimulationOwnerInputCandidate } from "./simulation-owner-input-candidate.ts";
import { buildSimulationOwnerInputPreflightModel } from "./simulation-owner-input-preflight.ts";
import { buildPrivateOwnerRawCloseSimulationReturnMatrix } from "./simulation-return-matrix.ts";
import {
  buildSimulationOwnerResearchExecution,
  resolveSimulationOwnerExecutionEndSelection,
} from "./simulation-owner-research-execution.ts";
import { prepareSimulationResearchPaths } from "./simulation-research-execution-core.ts";
import { buildSimulationOwnerCandidateComparison } from "./simulation-owner-candidate-comparison.ts";
import { buildSimulationOwnerWalkForwardValidation } from "./simulation-owner-walk-forward-validation.ts";
import { resolveSimulationResearchHorizon } from "./simulation-research-horizon.ts";
import {
  buildSimulationInputReadiness,
  buildSimulationInputReadinessPageModel,
  resolveSimulationEndServiceDateSelection,
} from "./simulation-input-readiness.ts";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "./portfolio-analysis-special-holding-authority.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";

export type SimulationPreviewQuery = {
  scope?: string | readonly string[];
  end?: string | string[];
  horizon?: string | string[];
  previewState?: string | string[];
};

// In-memory synthetic market inputs, used only by the explicit development preview.
export function buildSimulationDesignPreview(query: SimulationPreviewQuery) {
  const portfolio = buildPortfolioStructureDesignPreview(query.scope);
  const end =
    typeof query.end === "string" && isRiskDate(query.end)
      ? query.end
      : "2026-08-28";
  const endTime = Date.parse(end + "T00:00:00Z");
  const dates = Array.from({ length: 92 }, (_, index) =>
    new Date(endTime - (91 - index) * 86400000).toISOString().slice(0, 10),
  );
  const holdingRows = portfolio.structure.holdingRows.map((row) => {
    const decision =
      row.name === "KRX 금현물"
        ? DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold
        : row.name === "Fount 일임 포트폴리오"
          ? DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount
          : null;
    return decision
      ? {
          ...row,
          name: decision.assetName,
          account: decision.account,
          market: decision.market,
          currency: decision.currency,
          assetType: decision.assetType,
        }
      : row;
  });
  const candidate = buildSimulationOwnerInputCandidate({
    scopeKey: portfolio.selectedScope.key,
    portfolio: { ...portfolio.structure, holdingRows },
  });
  const instruments = candidate.instruments.filter(
    (row) =>
      row.classification === "listed_instrument" && (row.weightBps ?? 0) > 0,
  );
  const matrix = buildPrivateOwnerRawCloseSimulationReturnMatrix({
    requestedServiceDates: dates.slice(1),
    instruments: instruments.map((row) => ({
      ...row,
      historyStatus: "instrument_keyed",
    })),
    priceRows: instruments.flatMap((row, instrumentIndex) => {
      let price = 100;
      return dates.map((date, index) => {
        price *=
          1 +
          0.0006 +
          Math.sin(index * 1.79 + instrumentIndex) *
            (0.011 + instrumentIndex * 0.002) +
          Math.cos(index * 0.61) * 0.006;
        return {
          market: row.market,
          currency: row.currency,
          ticker: row.ticker,
          priceDate: date,
          rawClosePrice: price,
        };
      });
    }),
    fxRows: dates.map((date, index) => ({
      rateDate: date,
      usdKrw: 1380 + Math.sin(index * 0.15) * 15,
      status: "ok",
    })),
  });
  const preflight = buildSimulationOwnerInputPreflightModel({
    candidate,
    historicalPreflight: {
      requestedEndServiceDate: end,
      policy: { priceBasis: "raw_price_return" },
      instruments: candidate.instruments.map((row) => ({
        instrumentKey: row.instrumentKey,
        status:
          row.classification === "listed_instrument"
            ? "provenance_ready_for_separate_review"
            : "manual_history_required",
        admissionStatus:
          row.classification === "listed_instrument"
            ? "ready"
            : "manual_history_required",
        storedCoverage: null,
        provenance: null,
      })),
    },
  });
  const horizon = resolveSimulationResearchHorizon(query.horizon);
  const prepared = prepareSimulationResearchPaths({
    matrix,
    seed: 0x56415244,
    expectedBlockLength: 5,
    horizon: horizon.horizon ?? 63,
    pathCount: 500,
  });
  const execution = buildSimulationOwnerResearchExecution({
    candidate,
    inputPreflight: preflight,
    endSelection: resolveSimulationOwnerExecutionEndSelection({
      suppliedValue: query.end,
      latestCommonStoredServiceDate: end,
    }),
    horizonSelection: horizon,
    matrix: query.previewState === "missing" ? null : matrix,
    ...(prepared.status === "ready" ? { preparedPaths: prepared } : {}),
  });
  const currentWeights =
    execution.status === "ready" ? execution.executionWeights : [];
  const comparison = buildSimulationOwnerCandidateComparison({
    account: candidate.account,
    prepared: prepared.status === "ready" ? prepared : null,
    currentExecution: execution,
    currentWeights,
    samplePathCount: 12,
  });
  const validation = buildSimulationOwnerWalkForwardValidation({
    account: candidate.account,
    currentExecutionReady: execution.status === "ready",
    matrix,
    currentWeights,
  });
  const readiness = buildSimulationInputReadiness({
    requestedEndServiceDate: end,
    generatedAt: portfolio.generatedAt,
    inputs: [],
  });
  const model = buildSimulationInputReadinessPageModel({
    selection: resolveSimulationEndServiceDateSelection({
      suppliedValue: query.end,
      defaultEndServiceDate: end,
    }),
    selected: readiness,
    comparisonSource: readiness,
    history: [],
    researchHorizonSelection: horizon,
  });
  return { portfolio, execution, comparison, validation, preflight, model };
}
