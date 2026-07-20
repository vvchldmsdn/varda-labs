import "server-only";

import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { db } from "@/db/client";
import { getReadOnlySimulationPeriodPreflight } from "@/db/queries/simulation-return-matrix";
import { globalMarketFactors } from "@/db/schema";
import { resolveKodexVooFixedMixSelection } from "@/lib/kodex-voo-fixed-mix-selection";
import {
  SIMULATION_REGIME_BOOTSTRAP_POLICY,
  SIMULATION_REGIME_FACTOR_DEFINITIONS,
} from "@/lib/simulation-regime-bootstrap-policy";
import { buildSimulationRegimeResearch } from "@/lib/simulation-regime-research-execution";
import { resolveSimulationEndServiceDateSelection } from "@/lib/simulation-input-readiness";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

const REGIME_RESEARCH_CANDIDATES = Object.freeze([
  Object.freeze({
    displayName: "KODEX 200",
    market: "korea",
    currency: "KRW" as const,
    ticker: "069500",
  }),
  Object.freeze({
    displayName: "Vanguard S&P 500 ETF",
    market: "us",
    currency: "USD" as const,
    ticker: "VOO",
  }),
]);

export async function getReadOnlySimulationRegimeBootstrap(options?: {
  endServiceDate?: string | string[];
  kodexWeight?: string | string[];
  now?: Date;
}) {
  const now = options?.now ?? new Date();
  const selection = resolveSimulationEndServiceDateSelection({
    suppliedValue: options?.endServiceDate,
    defaultEndServiceDate: resolveSnapshotCycle(now).snapshotDate,
  });
  const explicitEndServiceDate =
    selection.status === "valid" && selection.source === "query"
      ? selection.endServiceDate
      : null;
  const fixedMixSelection = resolveKodexVooFixedMixSelection(
    options?.kodexWeight,
  );

  if (!explicitEndServiceDate) {
    return buildSimulationRegimeResearch({
      explicitEndServiceDate: null,
      matrix: null,
      factorRows: Object.freeze([]),
      selection: fixedMixSelection,
    });
  }

  const [preflight, factorRows] = await Promise.all([
    getReadOnlySimulationPeriodPreflight({
      candidates: REGIME_RESEARCH_CANDIDATES,
      endServiceDate: explicitEndServiceDate,
      returnStepCount:
        SIMULATION_REGIME_BOOTSTRAP_POLICY.sourceReturnStepCount,
    }),
    loadRegimeFactorRows(explicitEndServiceDate),
  ]);

  return buildSimulationRegimeResearch({
    explicitEndServiceDate,
    matrix: preflight.matrixArtifact,
    factorRows,
    selection: fixedMixSelection,
  });
}

async function loadRegimeFactorRows(endServiceDate: string) {
  const factorKeys = SIMULATION_REGIME_FACTOR_DEFINITIONS.map(
    (definition) => definition.factorKey,
  );
  return db
    .select({
      factorKey: globalMarketFactors.factorKey,
      factorDate: globalMarketFactors.factorDate,
      periodEndDate: globalMarketFactors.periodEndDate,
      releaseDate: globalMarketFactors.releaseDate,
      value: globalMarketFactors.value,
      volatility20dPct: globalMarketFactors.volatility20dPct,
    })
    .from(globalMarketFactors)
    .where(
      and(
        inArray(globalMarketFactors.factorKey, factorKeys),
        lte(globalMarketFactors.releaseDate, endServiceDate),
        eq(globalMarketFactors.isSample, false),
        eq(globalMarketFactors.isPreliminary, false),
      ),
    )
    .orderBy(
      asc(globalMarketFactors.factorKey),
      asc(globalMarketFactors.releaseDate),
      asc(globalMarketFactors.factorDate),
    );
}
