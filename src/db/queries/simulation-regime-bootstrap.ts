import "server-only";

import {
  loadRegimeFactorRows,
  REGIME_RESEARCH_CANDIDATES,
} from "@/db/queries/simulation-regime-evidence";
import { getReadOnlySimulationPeriodPreflightBatch } from "@/db/queries/simulation-return-matrix";
import { resolveKodexVooFixedMixSelection } from "@/lib/kodex-voo-fixed-mix-selection";
import { SIMULATION_REGIME_BOOTSTRAP_POLICY } from "@/lib/simulation-regime-bootstrap-policy";
import { buildSimulationRegimeResearch } from "@/lib/simulation-regime-research-execution";
import {
  buildSimulationRegimeReadinessHistory,
  buildSimulationRegimeReadinessHistoryDates,
} from "@/lib/simulation-regime-readiness-history";
import { resolveSimulationEndServiceDateSelection } from "@/lib/simulation-input-readiness";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

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
    const research = buildSimulationRegimeResearch({
      explicitEndServiceDate: null,
      matrix: null,
      factorRows: Object.freeze([]),
      selection: fixedMixSelection,
    });
    return Object.freeze({
      research,
      readinessHistory: buildSimulationRegimeReadinessHistory({
        selectedEndServiceDate: null,
        candidates: Object.freeze([]),
        factorRows: Object.freeze([]),
      }),
    });
  }

  const historyDates = buildSimulationRegimeReadinessHistoryDates(
    explicitEndServiceDate,
  );
  const [preflights, factorRows] = await Promise.all([
    getReadOnlySimulationPeriodPreflightBatch(
      historyDates.map((endServiceDate) => ({
        candidates: REGIME_RESEARCH_CANDIDATES,
        endServiceDate,
        returnStepCount:
          SIMULATION_REGIME_BOOTSTRAP_POLICY.sourceReturnStepCount,
      })),
    ),
    loadRegimeFactorRows(explicitEndServiceDate),
  ]);
  const selectedPreflight = preflights[0];
  const research = buildSimulationRegimeResearch({
    explicitEndServiceDate,
    matrix: selectedPreflight?.matrixArtifact ?? null,
    factorRows,
    selection: fixedMixSelection,
  });

  return Object.freeze({
    research,
    readinessHistory: buildSimulationRegimeReadinessHistory({
      selectedEndServiceDate: explicitEndServiceDate,
      candidates: historyDates.map((serviceDate, index) => ({
        serviceDate,
        matrix: preflights[index]?.matrixArtifact ?? null,
      })),
      factorRows,
    }),
  });
}
