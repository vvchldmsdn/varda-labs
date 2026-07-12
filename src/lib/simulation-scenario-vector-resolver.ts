import { SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY } from "./simulation-scenario-vector-resolver-policy.ts";
import type {
  SimulationScenarioVectorResolverBlockerReason,
  SimulationScenarioVectorResolverInput,
  SimulationScenarioVectorResolverResult,
} from "./simulation-scenario-vector-resolver-types.ts";
import {
  isNormalizedSimulationRepositoryResult,
  isNotRequestedSimulationRepositoryResult,
  isValidSimulationScenarioSelector,
  isValidSimulationTenantContext,
  validateLoadedSimulationApproval,
} from "./simulation-scenario-vector-resolver-validation.ts";

export type {
  SimulationApprovalAuditEnvelope,
  SimulationApprovalAuditStatus,
  SimulationApprovalLifecycleStatus,
  SimulationOwnerScopedApprovalRecord,
  SimulationScenarioSelector,
  SimulationScenarioVectorEvidencePort,
  SimulationScenarioVectorRepositoryPortResult,
  SimulationScenarioVectorResolverBlocker,
  SimulationScenarioVectorResolverBlockerReason,
  SimulationScenarioVectorResolverInput,
  SimulationScenarioVectorResolverResult,
} from "./simulation-scenario-vector-resolver-types.ts";
export { SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY } from "./simulation-scenario-vector-resolver-policy.ts";

export function resolveSimulationScenarioVectorApproval(
  input: SimulationScenarioVectorResolverInput,
): SimulationScenarioVectorResolverResult {
  const tenantContext = input?.tenantContext;
  const selector = input?.selector;
  const repositoryResult = input?.repositoryResult;
  const notRequested =
    isNotRequestedSimulationRepositoryResult(repositoryResult);

  if (!isValidSimulationTenantContext(tenantContext)) {
    return blocked(
      notRequested ? "tenant_context_invalid" : "resolver_state_invalid",
    );
  }
  if (!isValidSimulationScenarioSelector(selector)) {
    return blocked(
      notRequested ? "scenario_selector_invalid" : "resolver_state_invalid",
    );
  }
  if (!isNormalizedSimulationRepositoryResult(repositoryResult)) {
    return blocked("resolver_state_invalid");
  }

  switch (repositoryResult.state) {
    case "not_requested":
      return blocked("resolver_state_invalid");
    case "not_found":
      return blocked("scenario_not_found");
    case "not_current":
      return blocked("scenario_not_current");
    case "unavailable":
      return blocked("repository_unavailable");
    case "collision":
      return blocked("approval_collision");
    case "loaded": {
      const validation = validateLoadedSimulationApproval({
        tenantContext,
        selector,
        repositoryResult,
      });
      if (!validation.validated || validation.blocker) {
        return blocked(validation.blocker ?? "resolver_state_invalid");
      }
      return Object.freeze({
        resolutionStatus: "resolved",
        runtimeTrustStatus:
          SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.runtimeTrustStatus,
        evidence: validation.validated.evidence,
        blocker: null,
      });
    }
  }
}

function blocked(
  reason: SimulationScenarioVectorResolverBlockerReason,
): SimulationScenarioVectorResolverResult {
  return Object.freeze({
    resolutionStatus: "blocked",
    runtimeTrustStatus:
      SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.runtimeTrustStatus,
    evidence: null,
    blocker: Object.freeze({ reason }),
  });
}
