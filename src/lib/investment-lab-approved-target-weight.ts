import type { InvestmentLabAnchorSelection } from "./investment-lab-anchor-basket-anchor.ts";
import type {
  InvestmentLabAnchorEvidenceBlocker,
  InvestmentLabAnchorEvidenceResolution,
} from "./investment-lab-anchor-basket-evidence.ts";
import {
  buildInvestmentLabAnchorScheduledRebalanceScenario,
  type InvestmentLabAnchorScheduledRebalanceScenario,
} from "./investment-lab-anchor-scheduled-rebalance.ts";
import type { InvestmentLabActualPathPoint } from "./investment-lab-counterfactual-path.ts";
import {
  composeInvestmentLabAccountRows,
  compensatedSum,
  investmentLabCompositionActualRowsMatchModel,
  summarizeInvestmentLabCompositionRows,
} from "./investment-lab-account-composition-contract.ts";
import {
  composeInvestmentLabNamedAccountReturns,
  investmentLabReturnPeriodAxesMatch,
} from "./investment-lab-account-composition-return.ts";
import type { InvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import {
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
  type InvestmentLabModifiedDietzPeriod,
} from "./investment-lab-modified-dietz.ts";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";
import type { TargetPolicyUniverseSourceRow } from "./target-policy-holding-universe.ts";
import {
  resolveApprovedTargetPolicy,
  type ApprovedTargetPolicyPort,
} from "./target-policy-resolver.ts";

export const INVESTMENT_LAB_APPROVED_TARGET_WEIGHT_POLICY = Object.freeze({
  version: "approved_target_weight_monthly_research_path_v1",
  targetAuthority: "current_approved_target_policy_revision",
  universeAuthority: "current_owned_holding_universe_hash_match",
  effectiveDateRule: "scenario_anchor_on_or_after_policy_effective_date",
  cadence: "monthly",
  allAccountRule: "sum_only_complete_named_account_paths",
  historicalBackcastBeforeEffectiveDate: "forbidden",
  recommendationAuthority: "none",
  orderAuthority: "none",
} as const);

export type InvestmentLabApprovedTargetPolicyContext = Readonly<{
  approvedPolicyRead: Readonly<{
    status: "available" | "missing" | "conflict";
    policy: ApprovedTargetPolicyPort | null;
  }>;
  currentUniverse: Readonly<{
    account: string | null;
    rows: readonly TargetPolicyUniverseSourceRow[];
  }>;
}>;

export type InvestmentLabApprovedTargetWeightScenario = Readonly<{
  status: "ready" | "unavailable";
  policy: typeof INVESTMENT_LAB_APPROVED_TARGET_WEIGHT_POLICY;
  account: PortfolioAccountScope;
  anchor: InvestmentLabAnchorSelection;
  policyBindings: readonly Readonly<{
    account: NamedPortfolioAccount;
    policyVersion: string;
    effectiveServiceDate: string;
    universeHash: string;
    vectorHash: string;
  }>[];
  weights: readonly Readonly<{
    account: NamedPortfolioAccount;
    instrumentKey: string;
    label: string;
    targetWeightBps: number;
  }>[];
  summary: (NonNullable<
    InvestmentLabAnchorScheduledRebalanceScenario["summary"]
  > &
    Readonly<{
      allocationBasis:
        | "single_scope_approved_target_weight_monthly"
        | "named_account_approved_target_weight_monthly_then_sum";
    }>) | null;
  returnEstimate: InvestmentLabAnchorScheduledRebalanceScenario["returnEstimate"];
  rows: InvestmentLabAnchorScheduledRebalanceScenario["rows"];
  coverage: InvestmentLabAnchorScheduledRebalanceScenario["coverage"];
  evidenceBlockers: readonly InvestmentLabAnchorEvidenceBlocker[];
  blockers: readonly string[];
}>;

export function buildInvestmentLabApprovedTargetWeightScenario(input: Readonly<{
  account: NamedPortfolioAccount;
  anchor: InvestmentLabAnchorSelection;
  actualPath: readonly InvestmentLabActualPathPoint[];
  evidence: InvestmentLabAnchorEvidenceResolution | null;
  actualReturn: number | null;
  actualPeriods?: readonly InvestmentLabModifiedDietzPeriod[];
  targetPolicyContext: InvestmentLabApprovedTargetPolicyContext | null;
}>): InvestmentLabApprovedTargetWeightScenario {
  const context = input.targetPolicyContext;
  if (!context) {
    return unavailable(input.account, input.anchor, [
      "approved_target_policy_missing",
    ]);
  }
  if (
    context.approvedPolicyRead.status !== "available" ||
    context.approvedPolicyRead.policy === null
  ) {
    return unavailable(input.account, input.anchor, [
      context.approvedPolicyRead.status === "conflict"
        ? "approved_target_policy_conflict"
        : "approved_target_policy_missing",
    ]);
  }
  if (!input.anchor.selectedAnchorDate) {
    return unavailable(input.account, input.anchor, [
      "target_anchor_unavailable",
    ]);
  }

  const approvedPolicy = context.approvedPolicyRead.policy;
  const resolution = resolveApprovedTargetPolicy({
    request: {
      account: input.account,
      policyVersion: approvedPolicy.policyVersion,
      serviceDate: input.anchor.selectedAnchorDate,
    },
    approvedPolicy,
    currentUniverse: {
      account: context.currentUniverse.account ?? input.account,
      holdings: context.currentUniverse.rows,
    },
  });
  if (resolution.status !== "ready" || resolution.targetVector === null) {
    return unavailable(input.account, input.anchor, resolution.blockers);
  }

  const path = buildInvestmentLabAnchorScheduledRebalanceScenario({
    mode: "approved_target_weight_monthly",
    anchor: input.anchor,
    actualPath: input.actualPath,
    evidence: input.evidence,
    actualReturn: input.actualReturn,
    actualPeriods: input.actualPeriods,
    targetWeights: resolution.targetVector,
  });
  if (path.status !== "ready" || !path.summary) {
    return unavailable(
      input.account,
      input.anchor,
      path.blockers.map((row) => row.reason),
      path.evidenceBlockers,
    );
  }

  const labelsByKey = new Map(
    input.anchor.instruments.map((instrument) => [
      instrument.key,
      instrument.label,
    ]),
  );
  return Object.freeze({
    status: "ready" as const,
    policy: INVESTMENT_LAB_APPROVED_TARGET_WEIGHT_POLICY,
    account: input.account,
    anchor: input.anchor,
    policyBindings: Object.freeze([
      Object.freeze({
        account: input.account,
        policyVersion: approvedPolicy.policyVersion,
        effectiveServiceDate: approvedPolicy.effectiveServiceDate,
        universeHash: approvedPolicy.universeHash,
        vectorHash: approvedPolicy.vectorHash,
      }),
    ]),
    weights: Object.freeze(
      resolution.targetVector.map((row) =>
        Object.freeze({
          account: input.account,
          instrumentKey: row.instrumentKey,
          label: labelsByKey.get(row.instrumentKey) ?? row.ticker,
          targetWeightBps: row.targetWeightBps,
        }),
      ),
    ),
    summary: Object.freeze({
      ...path.summary,
      allocationBasis:
        "single_scope_approved_target_weight_monthly" as const,
    }),
    returnEstimate: path.returnEstimate,
    rows: path.rows,
    coverage: path.coverage,
    evidenceBlockers: path.evidenceBlockers,
    blockers: Object.freeze(path.blockers.map((row) => row.reason)),
  });
}

export function composeInvestmentLabApprovedTargetWeightScenario(input: Readonly<{
  pooledModel: InvestmentLabCounterfactualReadModel;
  pooledAnchor: InvestmentLabAnchorSelection;
  named: Readonly<
    Record<NamedPortfolioAccount, InvestmentLabApprovedTargetWeightScenario>
  >;
}>): InvestmentLabApprovedTargetWeightScenario {
  const unavailableAccounts = NAMED_PORTFOLIO_ACCOUNTS.filter(
    (account) => input.named[account].status !== "ready",
  );
  if (unavailableAccounts.length > 0) {
    return unavailable("all", input.pooledAnchor, [
      "named_account_target_policy_unavailable",
      ...unavailableAccounts.map(
        (account) => `target_policy_unavailable:${account}`,
      ),
    ]);
  }

  const composed = composeInvestmentLabAccountRows(
    (account) => input.named[account].rows,
  );
  if (composed.status !== "ready") {
    return unavailable("all", input.pooledAnchor, composed.blockers);
  }
  if (
    !investmentLabCompositionActualRowsMatchModel(
      composed.rows,
      input.pooledModel.observedPath.status === "ready"
        ? input.pooledModel.observedPath.rows.map((row) => ({
            serviceDate: row.serviceDate,
            actualMarketValueKrw: row.marketValueKrw,
          }))
        : [],
    )
  ) {
    return unavailable("all", input.pooledAnchor, [
      "account_composition_mismatch",
    ]);
  }

  const ready = NAMED_PORTFOLIO_ACCOUNTS.map(
    (account) => input.named[account],
  ) as readonly (InvestmentLabApprovedTargetWeightScenario &
    Readonly<{ status: "ready" }>)[];
  const actualReturn = composeInvestmentLabNamedAccountReturns(
    ready.map((scenario) => scenario.returnEstimate?.actualPeriods ?? []),
  );
  const scenarioReturn = composeInvestmentLabNamedAccountReturns(
    ready.map((scenario) => scenario.returnEstimate?.scenarioPeriods ?? []),
  );
  const returnEstimate =
    actualReturn.status === "ready" &&
    scenarioReturn.status === "ready" &&
    investmentLabReturnPeriodAxesMatch(
      actualReturn.periods,
      scenarioReturn.periods,
    )
      ? Object.freeze({
          method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
          actualReturn: actualReturn.totalReturn,
          scenarioReturn: scenarioReturn.totalReturn,
          differencePercentagePoints:
            (scenarioReturn.totalReturn - actualReturn.totalReturn) * 100,
          actualPeriods: actualReturn.periods,
          scenarioPeriods: scenarioReturn.periods,
          scenarioRiskMetrics: scenarioReturn.riskMetrics,
        })
      : null;
  const summary = summarizeInvestmentLabCompositionRows(composed.rows);
  return Object.freeze({
    status: "ready" as const,
    policy: INVESTMENT_LAB_APPROVED_TARGET_WEIGHT_POLICY,
    account: "all" as const,
    anchor: input.pooledAnchor,
    policyBindings: Object.freeze(
      ready.flatMap((scenario) => scenario.policyBindings),
    ),
    weights: Object.freeze(ready.flatMap((scenario) => scenario.weights)),
    summary: Object.freeze({
      ...summary,
      instrumentCount: compensatedSum(
        ready.map((scenario) => scenario.summary?.instrumentCount ?? 0),
      ),
      listedInstrumentCount: compensatedSum(
        ready.map((scenario) => scenario.summary?.listedInstrumentCount ?? 0),
      ),
      fixedManualInstrumentCount: compensatedSum(
        ready.map(
          (scenario) => scenario.summary?.fixedManualInstrumentCount ?? 0,
        ),
      ),
      allocationBasis:
        "named_account_approved_target_weight_monthly_then_sum" as const,
      rebalanceCount: compensatedSum(
        ready.map((scenario) => scenario.summary?.rebalanceCount ?? 0),
      ),
      deferredRebalanceCount: compensatedSum(
        ready.map(
          (scenario) => scenario.summary?.deferredRebalanceCount ?? 0,
        ),
      ),
    }),
    returnEstimate,
    rows: Object.freeze(
      composed.rows.map((row, index) =>
        Object.freeze({
          ...row,
          rebalanced: NAMED_PORTFOLIO_ACCOUNTS.some(
            (account) => input.named[account].rows[index].rebalanced,
          ),
        }),
      ),
    ),
    coverage: Object.freeze({
      componentCount: sumCoverage(ready, "componentCount"),
      listedComponentCount: sumCoverage(ready, "listedComponentCount"),
      fixedManualComponentCount: sumCoverage(
        ready,
        "fixedManualComponentCount",
      ),
      sourceFlowCount: sumCoverage(ready, "sourceFlowCount"),
      scenarioFlowLegCount: sumCoverage(ready, "scenarioFlowLegCount"),
      splitExecutionDateRows: sumCoverage(ready, "splitExecutionDateRows"),
      delayedExecutionLegs: sumCoverage(ready, "delayedExecutionLegs"),
      pendingComparisonRows: composed.rows.filter(
        (row) => row.hasPendingExecution,
      ).length,
      rebalanceCount: sumCoverage(ready, "rebalanceCount"),
      deferredRebalanceCount: sumCoverage(ready, "deferredRebalanceCount"),
      manualObservationRows: sumCoverage(ready, "manualObservationRows"),
      manualCarryRows: sumCoverage(ready, "manualCarryRows"),
    }),
    evidenceBlockers: [] as const,
    blockers: returnEstimate
      ? ([] as const)
      : (["scenario_return_unavailable"] as const),
  });
}

function unavailable(
  account: PortfolioAccountScope,
  anchor: InvestmentLabAnchorSelection,
  blockers: readonly string[],
  evidenceBlockers: readonly InvestmentLabAnchorEvidenceBlocker[] = [],
): InvestmentLabApprovedTargetWeightScenario {
  return Object.freeze({
    status: "unavailable" as const,
    policy: INVESTMENT_LAB_APPROVED_TARGET_WEIGHT_POLICY,
    account,
    anchor,
    policyBindings: [] as const,
    weights: [] as const,
    summary: null,
    returnEstimate: null,
    rows: [] as const,
    coverage: emptyCoverage(),
    evidenceBlockers: Object.freeze([...evidenceBlockers]),
    blockers: Object.freeze([...new Set(blockers)].sort()),
  });
}

export function unavailableInvestmentLabApprovedTargetWeightScenario(
  account: PortfolioAccountScope,
  anchor: InvestmentLabAnchorSelection,
  blockers: readonly string[],
) {
  return unavailable(account, anchor, blockers);
}

function emptyCoverage(): InvestmentLabAnchorScheduledRebalanceScenario["coverage"] {
  return Object.freeze({
    componentCount: 0,
    listedComponentCount: 0,
    fixedManualComponentCount: 0,
    sourceFlowCount: 0,
    scenarioFlowLegCount: 0,
    splitExecutionDateRows: 0,
    delayedExecutionLegs: 0,
    pendingComparisonRows: 0,
    rebalanceCount: 0,
    deferredRebalanceCount: 0,
    manualObservationRows: 0,
    manualCarryRows: 0,
  });
}

function sumCoverage(
  scenarios: readonly InvestmentLabApprovedTargetWeightScenario[],
  key: keyof InvestmentLabApprovedTargetWeightScenario["coverage"],
) {
  return compensatedSum(scenarios.map((scenario) => scenario.coverage[key]));
}
