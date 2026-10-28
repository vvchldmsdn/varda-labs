import { validateSimulationPathRiskInput } from "./simulation-path-risk-input-validation.ts";
import { SIMULATION_PATH_MAX_DRAWDOWN_POLICY } from "./simulation-path-max-drawdown-policy.ts";
import type {
  SimulationPathMaxDrawdownInput,
  SimulationPathMaxDrawdownValidationResult,
} from "./simulation-path-max-drawdown-types.ts";

export function validateSimulationPathMaxDrawdownInput(
  input: SimulationPathMaxDrawdownInput,
): SimulationPathMaxDrawdownValidationResult {
  const sharedValidation = validateSimulationPathRiskInput(input);
  if (!sharedValidation.validated) {
    return Object.freeze({
      validated: null,
      blockers: sharedValidation.blockers,
    });
  }

  const validated = sharedValidation.validated;
  const derivedMaxPathDrawdownRows = Math.floor(
    SIMULATION_PATH_MAX_DRAWDOWN_POLICY.maxInputNavPoints /
      (validated.horizon + 1),
  );
  if (
    !Number.isSafeInteger(derivedMaxPathDrawdownRows) ||
    derivedMaxPathDrawdownRows <= 0 ||
    derivedMaxPathDrawdownRows >
      SIMULATION_PATH_MAX_DRAWDOWN_POLICY.maxPathDrawdownRows ||
    validated.pathCount > derivedMaxPathDrawdownRows
  ) {
    return Object.freeze({
      validated: null,
      blockers: Object.freeze([
        Object.freeze({ reason: "input_nav_too_large" as const }),
      ]),
    });
  }

  return Object.freeze({
    validated: Object.freeze({
      ...validated,
      derivedMaxPathDrawdownRows,
    }),
    blockers: Object.freeze([]),
  });
}
