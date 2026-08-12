import {
  buildInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadModel,
  type InvestmentLabSourceCloseRow,
  type InvestmentLabSourceEventRow,
  type InvestmentLabSourceSnapshotRow,
} from "./investment-lab-counterfactual-read-model.ts";
import {
  composeInvestmentLabAllAccounts,
  notApplicableInvestmentLabAccountComposition,
  type InvestmentLabAccountComposition,
} from "./investment-lab-account-composition.ts";
import type { InvestmentLabVooFxRow } from "./investment-lab-voo-readiness.ts";
import type { InvestmentLabFixedMixSelection } from "./investment-lab-fixed-mix-selection.ts";
import {
  buildInvestmentLabRollingComparison,
  type InvestmentLabRollingComparison,
} from "./investment-lab-rolling-comparison.ts";
import {
  markInvestmentLabPeriodUnavailable,
  resolveInvestmentLabPeriodSelection,
  sliceInvestmentLabCounterfactualInput,
  type InvestmentLabPeriodRequest,
  type InvestmentLabPeriodSelection,
} from "./investment-lab-period-selection.ts";
import {
  loadInvestmentLabAnchorScenarios,
  type InvestmentLabAnchorBasketReadRepository,
  type InvestmentLabAnchorFountScope,
} from "./investment-lab-anchor-basket-read-loader.ts";
import type { InvestmentLabAnchorBasketScenario } from "./investment-lab-anchor-basket-scenario.ts";
import type { InvestmentLabAnchorValueWeightScenario } from "./investment-lab-anchor-value-weight-scenario.ts";
import type { InvestmentLabAnchorScheduledRebalanceScenario } from "./investment-lab-anchor-scheduled-rebalance.ts";
import type { InvestmentLabPreperiodOptimizer } from "./investment-lab-preperiod-optimizer.ts";
import {
  composeInvestmentLabApprovedTargetWeightScenario,
  type InvestmentLabApprovedTargetPolicyContext,
  type InvestmentLabApprovedTargetWeightScenario,
} from "./investment-lab-approved-target-weight.ts";
import {
  listInvestmentLabCompleteSnapshotDates,
  listInvestmentLabLatestCurrentWriterDates,
} from "./investment-lab-source-segment-authority.ts";
import {
  applyInvestmentLabFountObservedRuntimeScope,
  applyInvestmentLabFountRuntimeScope,
  type InvestmentLabFountRuntimeEvidence,
  type InvestmentLabFountRuntimeScope,
} from "./investment-lab-fount-runtime-scope.ts";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";
import {
  buildInvestmentLabAllAccountFundingPreflight,
  buildInvestmentLabNamedAccountFundingPreflight,
  type InvestmentLabAccountFundingPreflight,
} from "./investment-lab-account-funding-preflight.ts";
import {
  buildInvestmentLabObservedHistory,
  type InvestmentLabObservedHistory,
} from "./investment-lab-observed-history-segments.ts";

export interface InvestmentLabCounterfactualReadRepository
  extends InvestmentLabAnchorBasketReadRepository {
  loadEvents(): Promise<readonly InvestmentLabSourceEventRow[]>;
  loadSnapshots(): Promise<readonly InvestmentLabSourceSnapshotRow[]>;
  loadScenarioCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadVooCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadFxRows(): Promise<readonly InvestmentLabVooFxRow[]>;
  loadFountRuntimeEvidence(
    serviceDates: readonly string[],
  ): Promise<InvestmentLabFountRuntimeEvidence>;
  loadApprovedTargetPolicyContext?(
    account: NamedPortfolioAccount,
  ): Promise<InvestmentLabApprovedTargetPolicyContext>;
}

export async function loadInvestmentLabCounterfactualReadModel(
  repository: InvestmentLabCounterfactualReadRepository,
  request?: InvestmentLabPeriodRequest,
  fixedMixSelection?: InvestmentLabFixedMixSelection,
  requestedAnchorDate?: string | null,
  account: PortfolioAccountScope = "all",
): Promise<Readonly<{
  model: InvestmentLabCounterfactualReadModel;
  period: InvestmentLabPeriodSelection;
  rollingComparison: InvestmentLabRollingComparison;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  anchorCurrentWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  anchorEqualWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  approvedTargetWeightScenario: InvestmentLabApprovedTargetWeightScenario;
  preperiodOptimizer: InvestmentLabPreperiodOptimizer;
  fountScopeAdjustment: InvestmentLabFountRuntimeScope;
  accountComposition: InvestmentLabAccountComposition;
  fundingPreflight: InvestmentLabAccountFundingPreflight;
  observedHistory: InvestmentLabObservedHistory;
}>> {
  const [
    eventRows,
    snapshotRows,
    closeRows,
    vooCloseRows,
    fxRows,
    targetPolicyContexts,
  ] =
    await Promise.all([
      repository.loadEvents(),
      repository.loadSnapshots(),
      repository.loadScenarioCloses(),
      repository.loadVooCloses(),
      repository.loadFxRows(),
      loadApprovedTargetPolicyContexts(repository, account),
    ]);

  const input = Object.freeze({
    eventRows,
    snapshotRows,
    closeRows,
    vooCloseRows,
    fxRows,
  });
  const preperiodEvidence = Object.freeze({
    closeRows,
    vooCloseRows,
    fxRows,
  });
  const availableServiceDates = listInvestmentLabCompleteSnapshotDates(
    snapshotRows,
    account,
  );
  const period = resolveInvestmentLabPeriodSelection({
    request,
    availableServiceDates,
    defaultServiceDates: request
      ? undefined
      : listInvestmentLabLatestCurrentWriterDates(snapshotRows, account),
  });

  const selectedSource =
    period.status === "selected" || period.status === "current_writer"
      ? sliceInvestmentLabCounterfactualInput(input, period)
      : input;
  const fountServiceDates = listInvestmentLabCompleteSnapshotDates(
    selectedSource.snapshotRows,
    "all",
  );
  const fountEvidence =
    account === "irp" || account === "all"
      ? await repository.loadFountRuntimeEvidence(fountServiceDates)
      : ({ status: "not_applicable" } as const);
  const fountScope = applyInvestmentLabFountRuntimeScope({
    account,
    serviceDates: fountServiceDates,
    source: selectedSource,
    allEventRows: input.eventRows,
    evidence: fountEvidence,
  });
  const observedFountScope = applyInvestmentLabFountObservedRuntimeScope({
    account,
    serviceDates: fountServiceDates,
    source: selectedSource,
    allEventRows: input.eventRows,
    evidence: fountEvidence,
  });
  const observedFountBlocked =
    observedFountScope.scope.status === "partial" ||
    observedFountScope.scope.status === "blocked";
  const observedHistory = buildInvestmentLabObservedHistory(
    observedFountScope.source.snapshotRows,
    account,
    {
      forcedGapServiceDates: observedFountScope.scope.blockedServiceDates,
      additionalBlockers: observedFountBlocked
        ? ["fount_scope_adjustment_blocked"]
        : [],
    },
  );
  const anchorFountScope = resolveAnchorFountScope(
    fountScope.scope.status,
    fountEvidence,
  );
  const pooledModel = buildInvestmentLabCounterfactualReadModel(
    fountScope.source,
    {
      account,
      fixedMixSelection,
      fountScopeAdjustmentStatus: fountScope.scope.status,
      preperiodEvidence,
    },
  );
  const cachedAnchorRepository = cacheAnchorRepository(repository);
  let model = pooledModel;
  let accountComposition = notApplicableInvestmentLabAccountComposition();
  let anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  let anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  let anchorCurrentWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  let anchorEqualWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  let approvedTargetWeightScenario: InvestmentLabApprovedTargetWeightScenario;
  let preperiodOptimizer: InvestmentLabPreperiodOptimizer;
  let fundingPreflight: InvestmentLabAccountFundingPreflight;

  if (account === "all") {
    const namedModels = Object.freeze(
      Object.fromEntries(
        NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount) => [
          namedAccount,
          buildInvestmentLabCounterfactualReadModel(fountScope.source, {
            account: namedAccount,
            fixedMixSelection,
            fountScopeAdjustmentStatus:
              namedAccount === "irp"
                ? fountScope.scope.status
                : "not_applicable",
            preperiodEvidence,
          }),
        ]),
      ) as Record<NamedPortfolioAccount, InvestmentLabCounterfactualReadModel>,
    );
    const [pooledAnchorScenarios, ...namedAnchorScenarioValues] =
      await Promise.all([
        loadInvestmentLabAnchorScenarios({
          account,
          repository: cachedAnchorRepository,
          model: pooledModel,
          source: fountScope.source,
          fxRows,
          requestedAnchorDate,
          fountScopeAdjustment: anchorFountScope,
          approvedTargetPolicyContext: null,
        }),
        ...NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount) =>
          loadInvestmentLabAnchorScenarios({
            account: namedAccount,
            repository: cachedAnchorRepository,
            model: namedModels[namedAccount],
            source: fountScope.source,
            fxRows,
            requestedAnchorDate,
            fountScopeAdjustment:
              namedAccount === "irp"
                ? anchorFountScope
                : Object.freeze({ status: "not_applicable" }),
            includePreperiodOptimizer: false,
            approvedTargetPolicyContext:
              targetPolicyContexts[namedAccount] ?? null,
          }),
        ),
      ]);
    const namedAnchors = Object.freeze(
      Object.fromEntries(
        NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount, index) => [
          namedAccount,
          namedAnchorScenarioValues[index].equalWeight,
        ]),
      ) as Record<NamedPortfolioAccount, InvestmentLabAnchorBasketScenario>,
    );
    const namedAnchorValueWeights = Object.freeze(
      Object.fromEntries(
        NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount, index) => [
          namedAccount,
          namedAnchorScenarioValues[index].valueWeight,
        ]),
      ) as Record<
        NamedPortfolioAccount,
        InvestmentLabAnchorValueWeightScenario
      >,
    );
    const namedAnchorCurrentWeightMonthly = Object.freeze(
      Object.fromEntries(
        NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount, index) => [
          namedAccount,
          namedAnchorScenarioValues[index].scheduledCurrentWeight,
        ]),
      ) as Record<
        NamedPortfolioAccount,
        InvestmentLabAnchorScheduledRebalanceScenario
      >,
    );
    const namedAnchorEqualWeightMonthly = Object.freeze(
      Object.fromEntries(
        NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount, index) => [
          namedAccount,
          namedAnchorScenarioValues[index].scheduledEqualWeight,
        ]),
      ) as Record<
        NamedPortfolioAccount,
        InvestmentLabAnchorScheduledRebalanceScenario
      >,
    );
    const namedApprovedTargetWeights = Object.freeze(
      Object.fromEntries(
        NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount, index) => [
          namedAccount,
          namedAnchorScenarioValues[index].approvedTargetWeight,
        ]),
      ) as Record<
        NamedPortfolioAccount,
        InvestmentLabApprovedTargetWeightScenario
      >,
    );
    const composed = composeInvestmentLabAllAccounts({
      pooledModel,
      namedModels,
      pooledAnchor: pooledAnchorScenarios.equalWeight,
      namedAnchors,
      pooledAnchorValueWeight: pooledAnchorScenarios.valueWeight,
      namedAnchorValueWeights,
      pooledAnchorCurrentWeightMonthly:
        pooledAnchorScenarios.scheduledCurrentWeight,
      namedAnchorCurrentWeightMonthly,
      pooledAnchorEqualWeightMonthly:
        pooledAnchorScenarios.scheduledEqualWeight,
      namedAnchorEqualWeightMonthly,
    });
    model = composed.model;
    anchorBasketScenario = composed.anchorBasketScenario;
    anchorValueWeightScenario = composed.anchorValueWeightScenario;
    anchorCurrentWeightMonthlyScenario =
      composed.anchorCurrentWeightMonthlyScenario;
    anchorEqualWeightMonthlyScenario =
      composed.anchorEqualWeightMonthlyScenario;
    approvedTargetWeightScenario =
      composeInvestmentLabApprovedTargetWeightScenario({
        pooledModel: composed.model,
        pooledAnchor: pooledAnchorScenarios.equalWeight.anchor,
        named: namedApprovedTargetWeights,
      });
    preperiodOptimizer = requirePreperiodOptimizer(
      pooledAnchorScenarios.preperiodOptimizer,
    );
    accountComposition = composed.composition;
    fundingPreflight = buildInvestmentLabAllAccountFundingPreflight({
      namedModels,
      namedAnchors,
      namedAnchorValueWeights,
      namedAnchorCurrentWeightMonthly,
      namedAnchorEqualWeightMonthly,
      composition: composed.composition,
    });
  } else {
    const anchorScenarios = await loadInvestmentLabAnchorScenarios({
      account,
      repository: cachedAnchorRepository,
      model,
      source: fountScope.source,
      fxRows,
      requestedAnchorDate,
      fountScopeAdjustment: anchorFountScope,
      approvedTargetPolicyContext: targetPolicyContexts[account] ?? null,
    });
    anchorBasketScenario = anchorScenarios.equalWeight;
    anchorValueWeightScenario = anchorScenarios.valueWeight;
    anchorCurrentWeightMonthlyScenario =
      anchorScenarios.scheduledCurrentWeight;
    anchorEqualWeightMonthlyScenario = anchorScenarios.scheduledEqualWeight;
    approvedTargetWeightScenario = anchorScenarios.approvedTargetWeight;
    preperiodOptimizer = requirePreperiodOptimizer(
      anchorScenarios.preperiodOptimizer,
    );
    fundingPreflight = buildInvestmentLabNamedAccountFundingPreflight({
      account,
      model,
      anchorBasketScenario,
      anchorValueWeightScenario,
      anchorCurrentWeightMonthlyScenario,
      anchorEqualWeightMonthlyScenario,
    });
  }
  let resolvedPeriod = period;
  if (period.status === "selected") {
    const complete =
      model.observedPath.status === "ready" &&
      model.observedPath.summary.startServiceDate ===
        period.selectedStartServiceDate &&
      model.observedPath.summary.endServiceDate === period.selectedEndServiceDate;
    resolvedPeriod = complete
      ? period
      : markInvestmentLabPeriodUnavailable(period);
  }
  const rollingComparison = buildInvestmentLabRollingComparison({
    account,
    source: fountScope.source,
    availableServiceDates:
      model.observedPath.status === "ready"
        ? model.observedPath.rows.map((row) => row.serviceDate)
        : Object.freeze([]),
  });

  return Object.freeze({
    model,
    rollingComparison,
    period: resolvedPeriod,
    anchorBasketScenario,
    anchorValueWeightScenario,
    anchorCurrentWeightMonthlyScenario,
    anchorEqualWeightMonthlyScenario,
    approvedTargetWeightScenario,
    preperiodOptimizer,
    fountScopeAdjustment: fountScope.scope,
    accountComposition,
    fundingPreflight,
    observedHistory,
  });
}

async function loadApprovedTargetPolicyContexts(
  repository: InvestmentLabCounterfactualReadRepository,
  account: PortfolioAccountScope,
) {
  if (!repository.loadApprovedTargetPolicyContext) {
    return Object.freeze({}) as Readonly<
      Partial<
        Record<NamedPortfolioAccount, InvestmentLabApprovedTargetPolicyContext>
      >
    >;
  }
  const accounts =
    account === "all"
      ? NAMED_PORTFOLIO_ACCOUNTS
      : ([account] as readonly NamedPortfolioAccount[]);
  const values = await Promise.all(
    accounts.map(async (namedAccount) =>
      Object.freeze({
        account: namedAccount,
        context:
          await repository.loadApprovedTargetPolicyContext!(namedAccount),
      }),
    ),
  );
  return Object.freeze(
    Object.fromEntries(
      values.map((value) => [value.account, value.context]),
    ),
  ) as Readonly<
    Partial<
      Record<NamedPortfolioAccount, InvestmentLabApprovedTargetPolicyContext>
    >
  >;
}

function requirePreperiodOptimizer(
  value: InvestmentLabPreperiodOptimizer | null,
) {
  if (!value) {
    throw new Error("pre-period optimizer was omitted from a public read model");
  }
  return value;
}

function resolveAnchorFountScope(
  status: InvestmentLabFountRuntimeScope["status"],
  evidence: InvestmentLabFountRuntimeEvidence,
): InvestmentLabAnchorFountScope {
  if (status !== "applied") return Object.freeze({ status });
  if (evidence.status !== "ready") {
    return Object.freeze({ status: "blocked" });
  }
  return Object.freeze({ status: "applied", binding: evidence.binding });
}

function cacheAnchorRepository(
  repository: InvestmentLabAnchorBasketReadRepository,
): InvestmentLabAnchorBasketReadRepository {
  const positionReads = new Map<
    string,
    ReturnType<InvestmentLabAnchorBasketReadRepository["loadAnchorPositionRows"]>
  >();
  const priceReads = new Map<
    string,
    ReturnType<InvestmentLabAnchorBasketReadRepository["loadAnchorPriceRows"]>
  >();
  return Object.freeze({
    loadAnchorPositionRows(serviceDates: readonly string[]) {
      const key = serviceDates.join(",");
      const existing = positionReads.get(key);
      if (existing) return existing;
      const pending = repository.loadAnchorPositionRows(serviceDates);
      positionReads.set(key, pending);
      return pending;
    },
    loadAnchorPriceRows(
      input: Parameters<
        InvestmentLabAnchorBasketReadRepository["loadAnchorPriceRows"]
      >[0],
    ) {
      const key = JSON.stringify({
        instruments: input.instruments.map((instrument) => instrument.key),
        startServiceDate: input.startServiceDate,
        endServiceDate: input.endServiceDate,
      });
      const existing = priceReads.get(key);
      if (existing) return existing;
      const pending = repository.loadAnchorPriceRows(input);
      priceReads.set(key, pending);
      return pending;
    },
  });
}
