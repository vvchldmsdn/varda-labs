import type { SimulationHistoricalEvidenceAdmission } from "./simulation-historical-evidence-admission-types.ts";

export type SimulationPortfolioEvidenceEntry = Readonly<{
  weightBps: number;
  admission: SimulationHistoricalEvidenceAdmission;
}>;

export type SimulationPortfolioEvidenceSummary = Readonly<{
  status: "ready_full_portfolio" | "ready_eligible_subset" | "unavailable";
  displayAuthority:
    | "current_full_portfolio"
    | "eligible_instrument_subset"
    | "diagnostics_only";
  diagnosticStatus: "ready" | "partial" | "unavailable";
  totalPositiveWeightBps: number;
  admittedWeightBps: number;
  explicitlyExcludedWeightBps: number;
  incompleteModeledWeightBps: number;
  blockers: readonly string[];
}>;

export function summarizeSimulationPortfolioHistoricalEvidence(
  entries: readonly SimulationPortfolioEvidenceEntry[],
): SimulationPortfolioEvidenceSummary {
  const positiveEntries = entries.filter(
    (entry) => Number.isFinite(entry.weightBps) && entry.weightBps > 0,
  );
  const invalidWeight = entries.some(
    (entry) => !Number.isFinite(entry.weightBps) || entry.weightBps < 0,
  );
  const admitted = positiveEntries.filter(
    (entry) => entry.admission.status === "ready",
  );
  const explicitlyExcluded = positiveEntries.filter((entry) =>
    ["excluded_by_policy", "manual_history_required"].includes(
      entry.admission.status,
    ),
  );
  const incompleteModeled = positiveEntries.filter(
    (entry) =>
      entry.admission.status !== "ready" &&
      entry.admission.status !== "excluded_by_policy" &&
      entry.admission.status !== "manual_history_required",
  );
  const blockers = new Set<string>();

  if (invalidWeight) blockers.add("invalid_weight");
  for (const entry of incompleteModeled) blockers.add(entry.admission.status);
  if (admitted.length === 0) {
    blockers.add("no_admitted_positive_weight_instrument");
  }

  const totalPositiveWeightBps = sumWeights(positiveEntries);
  const admittedWeightBps = sumWeights(admitted);
  const explicitlyExcludedWeightBps = sumWeights(explicitlyExcluded);
  const incompleteModeledWeightBps = sumWeights(incompleteModeled);
  const status =
    !invalidWeight && incompleteModeled.length === 0 && admitted.length > 0
      ? explicitlyExcluded.length > 0
        ? "ready_eligible_subset"
        : "ready_full_portfolio"
      : "unavailable";
  const readyCount = admitted.length;

  return Object.freeze({
    status,
    displayAuthority:
      status === "ready_full_portfolio"
        ? "current_full_portfolio"
        : status === "ready_eligible_subset"
          ? "eligible_instrument_subset"
          : "diagnostics_only",
    diagnosticStatus:
      readyCount === positiveEntries.length && positiveEntries.length > 0
        ? "ready"
        : readyCount > 0
          ? "partial"
          : "unavailable",
    totalPositiveWeightBps,
    admittedWeightBps,
    explicitlyExcludedWeightBps,
    incompleteModeledWeightBps,
    blockers: Object.freeze([...blockers].sort()),
  });
}

function sumWeights(entries: readonly SimulationPortfolioEvidenceEntry[]) {
  return entries.reduce((sum, entry) => sum + entry.weightBps, 0);
}
