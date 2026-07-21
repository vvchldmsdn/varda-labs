import type { InvestmentLabAnchorBasketScenario } from "./investment-lab-anchor-basket-scenario.ts";
import type { InvestmentLabAnchorValueWeightScenario } from "./investment-lab-anchor-value-weight-scenario.ts";
import type { InvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import {
  composeInvestmentLabAnchor,
  composeInvestmentLabAnchorValueWeight,
  unavailableInvestmentLabAnchor,
  unavailableInvestmentLabAnchorValueWeight,
} from "./investment-lab-account-composition-anchor.ts";
import {
  INVESTMENT_LAB_ACCOUNT_COMPOSITION_POLICY,
  type InvestmentLabAccountComposition,
  type InvestmentLabAccountCompositionScenarioId,
  type InvestmentLabAccountCompositionScenarioResolution,
  type InvestmentLabCompositionValue,
  type InvestmentLabNamedAnchors,
  type InvestmentLabNamedAnchorValueWeights,
  type InvestmentLabNamedModels,
} from "./investment-lab-account-composition-contract.ts";
import {
  blockInvestmentLabPooledModel,
  composeInvestmentLabCash,
  composeInvestmentLabFixedMix,
  composeInvestmentLabFixedMixComparison,
  composeInvestmentLabMainCoverage,
  composeInvestmentLabMainModel,
  composeInvestmentLabObservedPath,
  composeInvestmentLabPreperiodMinVolatility,
  composeInvestmentLabVoo,
  unavailableInvestmentLabCash,
  unavailableInvestmentLabFixedMix,
  unavailableInvestmentLabVoo,
} from "./investment-lab-account-composition-paths.ts";
import { markInvestmentLabPreperiodMinVolatilityPathUnavailable } from "./investment-lab-preperiod-min-volatility.ts";
import { composeInvestmentLabMainReturnEstimate } from "./investment-lab-account-composition-return-models.ts";
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
  pooledAnchorValueWeight: InvestmentLabAnchorValueWeightScenario;
  namedAnchorValueWeights: InvestmentLabNamedAnchorValueWeights;
}>): Readonly<{
  model: InvestmentLabCounterfactualReadModel;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  composition: InvestmentLabAccountComposition;
}> {
  const observed = composeInvestmentLabObservedPath(
    input.pooledModel,
    input.namedModels,
  );
  const actualReturn =
    observed.status === "ready"
      ? observed.value.returnEstimate
      : input.pooledModel.observedPath.returnEstimate;
  const main = composeInvestmentLabMainModel(
    input.pooledModel,
    input.namedModels,
  );
  const voo = composeInvestmentLabVoo(
    input.pooledModel,
    input.namedModels,
    actualReturn,
  );
  const cash = composeInvestmentLabCash(
    input.pooledModel,
    input.namedModels,
    actualReturn,
  );
  const fixedMix = composeInvestmentLabFixedMix(
    input.pooledModel,
    input.namedModels,
    actualReturn,
  );
  const fixedMixComparison = composeInvestmentLabFixedMixComparison(
    input.pooledModel,
    input.namedModels,
    actualReturn,
  );
  const preperiodMinVolatility =
    composeInvestmentLabPreperiodMinVolatility(
      input.pooledModel,
      input.namedModels,
      actualReturn,
    );
  const anchor = composeInvestmentLabAnchor({
    pooledAnchor: input.pooledAnchor,
    namedAnchors: input.namedAnchors,
  });
  const anchorValueWeight = composeInvestmentLabAnchorValueWeight({
    pooledAnchor: input.pooledAnchorValueWeight,
    namedAnchors: input.namedAnchorValueWeights,
  });

  const scenarios = Object.freeze({
    actual: resolution(observed),
    kodex200: resolution(main),
    voo: resolution(voo),
    zero_return: resolution(cash),
    fixed_mix: resolution(fixedMix),
    preperiod_min_volatility: resolution(preperiodMinVolatility),
    anchor_basket: resolution(anchor),
    anchor_value_weight: resolution(anchorValueWeight),
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
      anchorValueWeightScenario:
        anchorValueWeight.status === "ready"
          ? anchorValueWeight.value
          : unavailableInvestmentLabAnchorValueWeight(
              input.pooledAnchorValueWeight,
              anchorValueWeight.blockers,
            ),
      composition,
    });
  }

  const mainReady = main.status === "ready";
  const mainRows = main.status === "ready" ? main.value : ([] as const);
  const mainReturnEstimate = mainReady
    ? composeInvestmentLabMainReturnEstimate(
        input.pooledModel,
        input.namedModels,
        actualReturn,
      )
    : null;
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
      returnEstimate: mainReturnEstimate,
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
      fixedMixComparison,
      preperiodMinVolatility:
        preperiodMinVolatility.status === "ready"
          ? preperiodMinVolatility.value
          : markInvestmentLabPreperiodMinVolatilityPathUnavailable(
              input.pooledModel.preperiodMinVolatility,
              hasCompositionBlocker(
                preperiodMinVolatility.blockers,
                "named_account_scenario_unavailable",
              )
                ? "account_composition_incomplete"
                : "account_composition_mismatch",
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
    anchorValueWeightScenario:
      anchorValueWeight.status === "ready"
        ? anchorValueWeight.value
        : unavailableInvestmentLabAnchorValueWeight(
            input.pooledAnchorValueWeight,
            anchorValueWeight.blockers,
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
    "preperiod_min_volatility",
    "anchor_basket",
    "anchor_value_weight",
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

function hasCompositionBlocker(
  blockers: readonly string[],
  blocker: string,
) {
  return blockers.some((value) => value === blocker);
}
