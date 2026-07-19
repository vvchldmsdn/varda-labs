import "server-only";

import { getReadOnlySimulationPeriodPreflightBatch } from "@/db/queries/simulation-return-matrix";
import { resolveKodexVooFixedMixSelection } from "@/lib/kodex-voo-fixed-mix-selection";
import {
  buildSimulationInputReadiness,
  buildSimulationInputReadinessDates,
  buildSimulationInputReadinessPageModel,
  resolveSimulationEndServiceDateSelection,
  SIMULATION_INPUT_READINESS_POLICY,
  type SimulationInputReadinessDescriptor,
} from "@/lib/simulation-input-readiness";
import { buildFixedResearchSimulation } from "@/lib/simulation-fixed-research-execution";
import { buildFixedMixResearchSimulation } from "@/lib/simulation-fixed-mix-research-execution";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

const KODEX_200 = Object.freeze({
  id: "kodex200",
  name: "KODEX 200",
  ticker: "069500",
  market: "korea",
  marketLabel: "한국",
  currency: "KRW",
  priceBasisLabel: "저장된 조정종가",
  fxBasisLabel: "환율 불필요",
}) satisfies SimulationInputReadinessDescriptor;

const VOO = Object.freeze({
  id: "voo",
  name: "Vanguard S&P 500 ETF",
  ticker: "VOO",
  market: "us",
  marketLabel: "미국",
  currency: "USD",
  priceBasisLabel: "저장된 조정종가 (투자 랩 가격 기준과 별도)",
  fxBasisLabel: "기준일별 저장 USD/KRW",
}) satisfies SimulationInputReadinessDescriptor;

const INPUTS = Object.freeze([KODEX_200, VOO]);

export async function getReadOnlySimulationInputReadiness(options?: {
  endServiceDate?: string | string[];
  kodexWeight?: string | string[];
  now?: Date;
}) {
  const now = options?.now ?? new Date();
  const selection = resolveSimulationEndServiceDateSelection({
    suppliedValue: options?.endServiceDate,
    defaultEndServiceDate: resolveSnapshotCycle(now).snapshotDate,
  });
  const requestedEndServiceDate = selection.endServiceDate;
  const historyDates = buildSimulationInputReadinessDates(
    requestedEndServiceDate,
  );
  const dates = historyDates.length > 0 ? historyDates : [""];
  const returnStepCount = SIMULATION_INPUT_READINESS_POLICY.returnStepCount;
  const independentRequests = dates.flatMap((endServiceDate) =>
    INPUTS.map((descriptor) => ({
      candidates: [candidate(descriptor)],
      endServiceDate,
      returnStepCount,
    })),
  );
  const comparisonRequest = {
    candidates: INPUTS.map(candidate),
    endServiceDate: requestedEndServiceDate,
    returnStepCount,
  };
  const preflights = await getReadOnlySimulationPeriodPreflightBatch(
    [...independentRequests, comparisonRequest],
  );
  const generatedAt = now.toISOString();
  const models = dates.map((endServiceDate, dateIndex) =>
    buildSimulationInputReadiness({
      requestedEndServiceDate:
        selection.status === "valid" ? endServiceDate : "",
      generatedAt,
      inputs: INPUTS.map((descriptor, inputIndex) => ({
        descriptor,
        preflight: preflights[dateIndex * INPUTS.length + inputIndex],
      })),
    }),
  );
  const selected = models[0];
  if (!selected) {
    throw new Error("Simulation input readiness projection is empty");
  }
  const comparisonPreflight = preflights[independentRequests.length];
  if (!comparisonPreflight) {
    throw new Error("Simulation comparison preflight is empty");
  }
  const comparisonSource = buildSimulationInputReadiness({
    requestedEndServiceDate,
    generatedAt,
    inputs: INPUTS.map((descriptor) => ({
      descriptor,
      preflight: comparisonPreflight,
    })),
  });
  const explicitEndServiceDate =
    selection.status === "valid" && selection.source === "query"
      ? selection.endServiceDate
      : null;
  const fixedMixSelection = resolveKodexVooFixedMixSelection(
    options?.kodexWeight,
  );
  const researchExecutions = INPUTS.map((descriptor, index) =>
    buildFixedResearchSimulation({
      id: descriptor.id,
      name: descriptor.name,
      ticker: descriptor.ticker,
      explicitEndServiceDate,
      matrix: preflights[index]?.matrixArtifact ?? null,
    }),
  );
  const fixedMixResearchExecution = buildFixedMixResearchSimulation({
    explicitEndServiceDate,
    matrix: comparisonPreflight.matrixArtifact,
    selection: fixedMixSelection,
  });

  return buildSimulationInputReadinessPageModel({
    selection,
    selected,
    comparisonSource,
    history: selection.status === "valid" ? models : [],
    researchExecutions,
    fixedMixResearchExecution,
    fixedMixSelection,
  });
}

function candidate(descriptor: SimulationInputReadinessDescriptor) {
  return {
    displayName: descriptor.name,
    market: descriptor.market,
    currency: descriptor.currency,
    ticker: descriptor.ticker,
  };
}
