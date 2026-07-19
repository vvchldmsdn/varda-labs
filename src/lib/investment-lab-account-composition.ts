import type { InvestmentLabAnchorBasketScenario } from "./investment-lab-anchor-basket-scenario.ts";
import type { InvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import {
  composeInvestmentLabAnchor,
  unavailableInvestmentLabAnchor,
} from "./investment-lab-account-composition-anchor.ts";
import {
  INVESTMENT_LAB_ACCOUNT_COMPOSITION_POLICY,
  type InvestmentLabAccountComposition,
  type InvestmentLabAccountCompositionScenarioId,
  type InvestmentLabAccountCompositionScenarioResolution,
  type InvestmentLabCompositionBoundaryFlow,
  type InvestmentLabCompositionValue,
  type InvestmentLabNamedAnchors,
  type InvestmentLabNamedModels,
} from "./investment-lab-account-composition-contract.ts";
import {
  blockInvestmentLabPooledModel,
  composeInvestmentLabCash,
  composeInvestmentLabFixedMix,
  composeInvestmentLabMainCoverage,
  composeInvestmentLabMainModel,
  composeInvestmentLabObservedPath,
  composeInvestmentLabVoo,
  unavailableInvestmentLabCash,
  unavailableInvestmentLabFixedMix,
  unavailableInvestmentLabVoo,
} from "./investment-lab-account-composition-paths.ts";
import { summarizeInvestmentLabCompositionRows } from "./investment-lab-account-composition-contract.ts";

export {
  INVESTMENT_LAB_ACCOUNT_COMPOSITION_POLICY,
  type InvestmentLabAccountComposition,
  type InvestmentLabAccountCompositionBlocker,
  type InvestmentLabAccountCompositionScenarioId,
} from "./investment-lab-account-composition-contract.ts";

export function notApplicableInvestmentLabAccountComposition(): InvestmentLabAccountComposition {
  return Object.freeze({
    status: "not_applicable",
    policy: INVESTMENT_LAB_ACCOUNT_COMPOSITION_POLICY,
    scenarios: scenarioRecord("not_requested", []),
  });
}

export function composeInvestmentLabAllAccounts(input: Readonly<{
  pooledModel: InvestmentLabCounterfactualReadModel;
  namedModels: InvestmentLabNamedModels;
  pooledAnchor: InvestmentLabAnchorBasketScenario;
  namedAnchors: InvestmentLabNamedAnchors;
  boundaryFlows: readonly InvestmentLabCompositionBoundaryFlow[];
}>): Readonly<{
  model: InvestmentLabCounterfactualReadModel;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  composition: InvestmentLabAccountComposition;
}> {
  const observed = composeInvestmentLabObservedPath(
    input.pooledModel,
    input.namedModels,
  );
  const main = composeInvestmentLabMainModel(
    input.pooledModel,
    input.namedModels,
  );
  const voo = composeInvestmentLabVoo(input.pooledModel, input.namedModels);
  const cash = composeInvestmentLabCash(input.pooledModel, input.namedModels);
  const fixedMix = composeInvestmentLabFixedMix(
    input.pooledModel,
    input.namedModels,
  );
  const anchor = composeInvestmentLabAnchor({
    pooledModel: input.pooledModel,
    pooledAnchor: input.pooledAnchor,
    namedAnchors: input.namedAnchors,
    boundaryFlows: input.boundaryFlows,
  });

  const scenarios = Object.freeze({
    actual: resolution(observed),
    kodex200: resolution(main),
    voo: resolution(voo),
    zero_return: resolution(cash),
    fixed_mix: resolution(fixedMix),
    anchor_basket: resolution(anchor),
  });
  const required = Object.values(scenarios).filter(
    (scenario) => scenario.status !== "not_requested",
  );
  const status =
    observed.status !== "ready"
      ? "unavailable"
      : required.some((scenario) => scenario.status === "unavailable")
        ? "partial"
        : "ready";
  const composition = Object.freeze({
    status,
    policy: INVESTMENT_LAB_ACCOUNT_COMPOSITION_POLICY,
    scenarios,
  });

  if (observed.status !== "ready") {
    return Object.freeze({
      model: blockInvestmentLabPooledModel(
        input.pooledModel,
        observed.blockers,
      ),
      anchorBasketScenario:
        anchor.status === "ready"
          ? anchor.value
          : unavailableInvestmentLabAnchor(
              input.pooledAnchor,
              anchor.blockers,
            ),
      composition,
    });
  }

  const mainReady = main.status === "ready";
  const mainRows = main.status === "ready" ? main.value : ([] as const);
  const mainBlockers =
    main.status === "ready" ? ([] as const) : main.blockers;

  return Object.freeze({
    model: Object.freeze({
      ...input.pooledModel,
      status: mainReady ? ("ready" as const) : ("blocked" as const),
      observedPath: observed.value,
      summary: mainReady
        ? summarizeInvestmentLabCompositionRows(mainRows)
        : null,
      returnEstimate: mainReady ? input.pooledModel.returnEstimate : null,
      rows: mainRows,
      vooComparison:
        voo.status === "ready"
          ? voo.value
          : unavailableInvestmentLabVoo(voo.blockers),
      cashComparison:
        cash.status === "ready"
          ? cash.value
          : unavailableInvestmentLabCash(cash.blockers),
      fixedMixScenario:
        fixedMix.status === "ready"
          ? fixedMix.value
          : fixedMix.status === "not_requested"
            ? null
            : unavailableInvestmentLabFixedMix(
                input.pooledModel,
                fixedMix.blockers,
              ),
      contributionExperimentScenarios:
        voo.status === "ready"
          ? input.pooledModel.contributionExperimentScenarios
          : Object.freeze([]),
      coverage: composeInvestmentLabMainCoverage(
        input.pooledModel,
        input.namedModels,
        mainRows,
        observed.value.rows.length,
      ),
      blockers: mainReady
        ? ([] as const)
        : (Object.freeze([
            ...new Set([
              ...input.pooledModel.blockers,
              mainBlockers.includes("named_account_model_unavailable")
                ? "account_composition_incomplete"
                : "account_composition_mismatch",
            ]),
          ]) as InvestmentLabCounterfactualReadModel["blockers"]),
    }),
    anchorBasketScenario:
      anchor.status === "ready"
        ? anchor.value
        : unavailableInvestmentLabAnchor(
            input.pooledAnchor,
            anchor.blockers,
          ),
    composition,
  });
}

function scenarioRecord(
  status: InvestmentLabAccountCompositionScenarioResolution["status"],
  blockers: InvestmentLabAccountCompositionScenarioResolution["blockers"],
) {
  const ids: readonly InvestmentLabAccountCompositionScenarioId[] = [
    "actual",
    "kodex200",
    "voo",
    "zero_return",
    "fixed_mix",
    "anchor_basket",
  ];
  return Object.freeze(
    Object.fromEntries(
      ids.map((id) => [
        id,
        Object.freeze({ status, blockers: Object.freeze([...blockers]) }),
      ]),
    ) as Record<
      InvestmentLabAccountCompositionScenarioId,
      InvestmentLabAccountCompositionScenarioResolution
    >,
  );
}

function resolution<T>(
  input: InvestmentLabCompositionValue<T>,
): InvestmentLabAccountCompositionScenarioResolution {
  return Object.freeze({
    status: input.status,
    blockers: Object.freeze([...input.blockers]),
  });
}
