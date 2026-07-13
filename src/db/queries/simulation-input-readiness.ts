import "server-only";

import { getReadOnlySimulationPeriodPreflight } from "@/db/queries/simulation-return-matrix";
import {
  buildSimulationInputReadiness,
  SIMULATION_INPUT_READINESS_POLICY,
  type SimulationInputReadinessDescriptor,
} from "@/lib/simulation-input-readiness";
import { isRiskDate } from "@/lib/portfolio-risk-calendar";
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

export async function getReadOnlySimulationInputReadiness(options?: {
  endServiceDate?: string | null;
  now?: Date;
}) {
  const now = options?.now ?? new Date();
  const requestedEndServiceDate =
    options?.endServiceDate?.trim() || resolveSnapshotCycle(now).snapshotDate;
  const returnStepCount = SIMULATION_INPUT_READINESS_POLICY.returnStepCount;
  const [kodex200, voo] = await Promise.all([
    getReadOnlySimulationPeriodPreflight({
      candidates: [candidate(KODEX_200)],
      endServiceDate: requestedEndServiceDate,
      returnStepCount,
    }),
    getReadOnlySimulationPeriodPreflight({
      candidates: [candidate(VOO)],
      endServiceDate: requestedEndServiceDate,
      returnStepCount,
    }),
  ]);

  return buildSimulationInputReadiness({
    requestedEndServiceDate: isRiskDate(requestedEndServiceDate)
      ? requestedEndServiceDate
      : "",
    generatedAt: now.toISOString(),
    inputs: [
      { descriptor: KODEX_200, preflight: kodex200 },
      { descriptor: VOO, preflight: voo },
    ],
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
