import type { SimulationHistoricalEvidenceAdmission } from "./simulation-historical-evidence-admission-types.ts";

export type SimulationPortfolioEvidenceEntry = Readonly<{
  weightBps: number;
  admission: SimulationHistoricalEvidenceAdmission;
}>;

export type SimulationPortfolioEvidenceSummary = Readonly<{
  status:
    | "ready_full_portfolio"
    | "ready_eligible_subset"
    | "partial_modeled_subset"
    | "unavailable";
  displayAuthority:
    | "current_full_portfolio"
    | "eligible_instrument_subset"
    | "partial_modeled_instrument_subset"
    | "diagnostics_only";
  consumerAuthority:
    | "full_portfolio_research"
    | "eligible_subset_research"
    | "partial_subset_research_only"
    | "diagnostics_only";
  weightPolicy: "preserve_original_weight_mass_without_renormalization";
  forbiddenConsumers: readonly (
    | "research_fan"
    | "current_portfolio_label"
    | "target_comparison"
    | "current_vs_candidate_comparison"
    | "optimizer"
    | "recommendation"
    | "order"
  )[];
  diagnosticStatus: "ready" | "partial" | "unavailable";
  totalPositiveWeightBps: number;
  admittedWeightBps: number;
  explicitlyExcludedWeightBps: number;
  manualHistoryRequiredWeightBps: number;
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
  const explicitlyExcluded = positiveEntries.filter(
    (entry) => entry.admission.status === "excluded_by_policy",
  );
  const manualHistoryRequired = positiveEntries.filter(
    (entry) => entry.admission.status === "manual_history_required",
  );
  const incompleteModeled = positiveEntries.filter(
    (entry) =>
      entry.admission.status !== "ready" &&
      entry.admission.status !== "excluded_by_policy",
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
  const manualHistoryRequiredWeightBps = sumWeights(manualHistoryRequired);
  const incompleteModeledWeightBps = sumWeights(incompleteModeled);
  const status =
    invalidWeight || admitted.length === 0
      ? "unavailable"
      : incompleteModeled.length > 0
        ? "partial_modeled_subset"
        : explicitlyExcluded.length > 0
          ? "ready_eligible_subset"
          : "ready_full_portfolio";
  const readyCount = admitted.length;
  const consumerAuthority =
    status === "ready_full_portfolio"
      ? ("full_portfolio_research" as const)
      : status === "ready_eligible_subset"
        ? ("eligible_subset_research" as const)
        : status === "partial_modeled_subset"
          ? ("partial_subset_research_only" as const)
          : ("diagnostics_only" as const);

  return Object.freeze({
    status,
    displayAuthority:
      status === "ready_full_portfolio"
        ? "current_full_portfolio"
        : status === "ready_eligible_subset"
          ? "eligible_instrument_subset"
          : status === "partial_modeled_subset"
            ? "partial_modeled_instrument_subset"
            : "diagnostics_only",
    consumerAuthority,
    weightPolicy: "preserve_original_weight_mass_without_renormalization",
    forbiddenConsumers: forbiddenConsumersFor(consumerAuthority),
    diagnosticStatus:
      readyCount === positiveEntries.length && positiveEntries.length > 0
        ? "ready"
        : readyCount > 0
          ? "partial"
          : "unavailable",
    totalPositiveWeightBps,
    admittedWeightBps,
    explicitlyExcludedWeightBps,
    manualHistoryRequiredWeightBps,
    incompleteModeledWeightBps,
    blockers: Object.freeze([...blockers].sort()),
  });
}

function sumWeights(entries: readonly SimulationPortfolioEvidenceEntry[]) {
  return entries.reduce((sum, entry) => sum + entry.weightBps, 0);
}

function forbiddenConsumersFor(
  authority: SimulationPortfolioEvidenceSummary["consumerAuthority"],
): SimulationPortfolioEvidenceSummary["forbiddenConsumers"] {
  const alwaysForbidden = ["optimizer", "recommendation", "order"] as const;
  if (authority === "full_portfolio_research") {
    return Object.freeze([...alwaysForbidden]);
  }

  const subsetRestrictions = [
    "current_portfolio_label",
    "target_comparison",
    "current_vs_candidate_comparison",
    ...alwaysForbidden,
  ] as const;
  return authority === "diagnostics_only"
    ? Object.freeze(["research_fan", ...subsetRestrictions])
    : Object.freeze([...subsetRestrictions]);
}
