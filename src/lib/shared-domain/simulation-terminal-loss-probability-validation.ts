import { validateSimulationPathRiskInput } from "./simulation-path-risk-input-validation.ts";
import type {
  SimulationTerminalLossProbabilityInput,
  SimulationTerminalLossProbabilityValidationResult,
} from "./simulation-terminal-loss-probability-types.ts";

export function validateSimulationTerminalLossProbabilityInput(
  input: SimulationTerminalLossProbabilityInput,
): SimulationTerminalLossProbabilityValidationResult {
  const validation = validateSimulationPathRiskInput(input);
  return Object.freeze({
    validated: validation.validated,
    blockers: validation.blockers,
  });
}
