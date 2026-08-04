import type { SimulationOwnerInputCandidate } from "./simulation-owner-input-candidate.ts";
import type { SimulationHistoricalEvidenceStatus } from "./simulation-historical-evidence-admission-types.ts";
import {
  summarizeSimulationPortfolioHistoricalEvidenceStatuses,
  type SimulationPortfolioEvidenceSummary,
} from "./simulation-portfolio-historical-evidence-summary.ts";

export type SimulationOwnerHistoricalPreflight = Readonly<{
  requestedEndServiceDate: string | null;
  policy?: Readonly<{
    priceBasis?: string;
    corporateActionAdjustment?: string;
    distributionAdjustment?: string;
  }>;
  instruments: readonly Readonly<{
    instrumentKey: string;
    status: string;
    admissionStatus: SimulationHistoricalEvidenceStatus | null;
    storedCoverage: unknown;
    provenance: unknown;
  }>[];
}>;

export type SimulationOwnerInputPreflightModel = ReturnType<
  typeof buildSimulationOwnerInputPreflightModel
>;

export function buildSimulationOwnerInputPreflightModel(input: {
  candidate: SimulationOwnerInputCandidate;
  historicalPreflight: SimulationOwnerHistoricalPreflight | null;
}) {
  const historicalByKey = new Map(
    (input.historicalPreflight?.instruments ?? []).map((row) => [
      row.instrumentKey,
      row,
    ]),
  );
  const rows = input.candidate.instruments.map((row) => {
    const historical = historicalByKey.get(row.instrumentKey) ?? null;
    return Object.freeze({
      ...row,
      historicalStatus: historical?.status ?? "not_evaluated",
      admissionStatus: historical?.admissionStatus ?? null,
      storedCoverage: historical?.storedCoverage ?? null,
      provenance: historical?.provenance ?? null,
    });
  });
  const evidenceSummary = buildEvidenceSummary(rows);

  return Object.freeze({
    account: input.candidate.account,
    policy: input.candidate.policy,
    runtimeTrustStatus: input.candidate.runtimeTrustStatus,
    executionStatus: input.candidate.executionStatus,
    status:
      input.candidate.status === "diagnostics_only"
        ? ("diagnostics_only" as const)
        : evidenceSummary?.status ?? ("diagnostics_only" as const),
    requestedEndServiceDate:
      input.historicalPreflight?.requestedEndServiceDate ?? null,
    historicalPriceBasis:
      input.historicalPreflight?.policy?.priceBasis ?? null,
    corporateActionAdjustment:
      input.historicalPreflight?.policy?.corporateActionAdjustment ?? null,
    distributionAdjustment:
      input.historicalPreflight?.policy?.distributionAdjustment ?? null,
    summary: input.candidate.summary,
    evidenceSummary,
    instruments: Object.freeze(rows),
    identityGaps: input.candidate.identityGaps,
    valuationGaps: input.candidate.valuationGaps,
    blockers: input.candidate.blockers,
  });
}

function buildEvidenceSummary(
  rows: readonly Readonly<{
    weightBps: number | null;
    admissionStatus: SimulationHistoricalEvidenceStatus | null;
  }>[],
): SimulationPortfolioEvidenceSummary | null {
  const positiveRows = rows.filter(
    (row) => row.weightBps !== null && row.weightBps > 0,
  );
  if (
    positiveRows.length === 0 ||
    rows.some((row) => row.weightBps === null) ||
    positiveRows.some((row) => row.admissionStatus === null)
  ) {
    return null;
  }

  return summarizeSimulationPortfolioHistoricalEvidenceStatuses(
    positiveRows.map((row) => ({
      weightBps: row.weightBps as number,
      admissionStatus:
        row.admissionStatus as SimulationHistoricalEvidenceStatus,
    })),
  );
}
