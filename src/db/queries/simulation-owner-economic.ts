import "server-only";

import { loadSimulationFactorRows } from "./simulation-regime-evidence";
import type { ReadOnlyTenantSimulationOwnerResearchResult } from "./simulation-owner-research";
import { buildSimulationOwnerEconomicResearch } from "@/lib/simulation-owner-economic-research";
import { buildSimulationOwnerEconomicValidation } from "@/lib/simulation-owner-economic-validation";

// Request-scoped owner input only; neither provider calls nor global private caches.
export async function getReadOnlyTenantSimulationOwnerEconomicResearch(options: {
  ownerResearchPromise: Promise<ReadOnlyTenantSimulationOwnerResearchResult>;
  stateAsOfServiceDate: string;
  includeDisplayPaths?: boolean;
}) {
  const owner = await options.ownerResearchPromise;
  const input = owner.parametricFactorInput;
  const factorRows = input ? await loadSimulationFactorRows(options.stateAsOfServiceDate) : [];
  return buildSimulationOwnerEconomicResearch({
    account: owner.execution.account,
    matrix: input?.matrix ?? null,
    weights: input?.weights ?? [],
    horizon: input?.horizon ?? null,
    ownerExecutionReady: input !== null,
    stateAsOfServiceDate: options.stateAsOfServiceDate,
    factorRows,
    includeDisplayPaths: options.includeDisplayPaths ?? false,
  });
}

export async function getReadOnlyTenantSimulationOwnerEconomicValidation(options: {
  ownerResearchPromise: Promise<ReadOnlyTenantSimulationOwnerResearchResult>;
}) {
  const owner = await options.ownerResearchPromise;
  const input = owner.modelCalibrationInput;
  const factorRows = input.factorAsOfServiceDate ? await loadSimulationFactorRows(input.factorAsOfServiceDate) : [];
  return buildSimulationOwnerEconomicValidation({
    execution: owner.execution,
    availableServiceDates: input.availableServiceDates,
    endpoints: input.endpoints,
    factorRows,
  });
}

export function economicResearchPresentation(result: ReturnType<typeof buildSimulationOwnerEconomicResearch>) {
  // Large typed arrays are server-only: the browser receives summaries, never paths per holding.
  const { prepared, ...presentation } = result;
  void prepared;
  return presentation;
}

export type SimulationEconomicPresentation = ReturnType<typeof economicResearchPresentation>;
