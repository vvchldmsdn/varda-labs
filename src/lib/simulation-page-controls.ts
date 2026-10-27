import { resolveKodexVooFixedMixSelection } from "./kodex-voo-fixed-mix-selection.ts";
import {
  resolveSimulationEndServiceDateSelection,
  type SimulationInputReadinessPageModel,
} from "./simulation-input-readiness.ts";
import { resolveSimulationResearchHorizon } from "./simulation-research-horizon.ts";
import { resolveSnapshotCycle } from "./snapshots/market-calendar.ts";

export type SimulationPageControls = Pick<
  SimulationInputReadinessPageModel,
  | "generatedAt"
  | "runtimeTrustStatus"
  | "requestedEndServiceDate"
  | "endServiceDateSelection"
  | "fixedMixSelection"
  | "researchHorizonSelection"
>;

/** Page controls need query validation, not unrelated benchmark history reads. */
export function buildSimulationPageControls(options: {
  endServiceDate?: string | string[];
  horizon?: string | string[];
  kodexWeight?: string | string[];
  now: Date;
}): SimulationPageControls {
  const selection = resolveSimulationEndServiceDateSelection({
    suppliedValue: options.endServiceDate,
    defaultEndServiceDate: resolveSnapshotCycle(options.now).snapshotDate,
  });
  return Object.freeze({
    generatedAt: options.now.toISOString(),
    runtimeTrustStatus: "not_established",
    requestedEndServiceDate: selection.endServiceDate,
    endServiceDateSelection: selection,
    fixedMixSelection: resolveKodexVooFixedMixSelection(options.kodexWeight),
    researchHorizonSelection: resolveSimulationResearchHorizon(options.horizon),
  });
}
